// The game mixes three independently-timed animation systems, so three knobs are needed:
//   1. Phaser loop delta   -> sprite animations, camera fades & scene.time timers (delta-based).
//   2. setTimeout frame rate-> the loop runs in setTimeout mode; shortening delays speeds up the
//                              game's own setTimeout-paced sequencing.
//   3. Tween ticker getDelta-> the game's TweenManager paces itself on Date.now() (real clock),
//                              ignoring the loop entirely; this drives most battle animations.
// All three read window.__UNL_SPEED, so the popup can change speed live.
//
// The render frame rate (__UNL_FPS_CAP) is a separate dial, not a fourth speed knob. Phaser drives
// update and render from one loop, so it also sets the pace of anything counted in frames rather
// than milliseconds -- a few menu transitions -- while rendering is the expensive half on a weak
// GPU. Keep it at one update per render: running extra update passes per frame also re-runs
// SceneManager.processQueue(), and the game gates its scene handoffs on reads taken before that
// queue drains (`isSleeping() && wake()`), so draining it more than once a frame strands them.

(function() {
if(location.hostname !== 'www.playunlight-dmm.com' || location.pathname !== '/') {
    return;
}

var api = (typeof browser !== 'undefined') ? browser : chrome;

var injected = false;

function inject(initial, initialCap) {
    if(injected) {
        return;
    }
    injected = true;

    var code = '(' + function(INIT, CAP) {
        if(window.__UNL_HOOK_INSTALLED) {
            if(typeof INIT === 'number' && INIT > 0) window.__UNL_SPEED = INIT;
            if(typeof CAP === 'number') window.__UNL_FPS_CAP = CAP;
            return;
        }
        window.__UNL_HOOK_INSTALLED = true;
        window.__UNL_SPEED          = (typeof INIT === 'number' && INIT > 0) ? INIT : 2;
        window.__UNL_TIMER_MAX      = 5000; // leave long (network/session) timers untouched
        window.__UNL_FPS_CAP        = (typeof CAP === 'number') ? CAP : -1; // <0 auto, 0 off, >0 fixed
        window.__UNL_FPS_MIN        = 20;  // auto mode floor
        window.__UNL_FPS_MAX        = 60;  // auto mode ceiling
        window.setUnlightSpeed      = function(x) {
            window.__UNL_SPEED = Number(x) || 1;
            applyRate();
            return window.__UNL_SPEED;
        };
        window.setUnlightFpsCap = function(x) {
            window.__UNL_FPS_CAP = Number(x) || 0;
            applyRate();
            return window.__UNL_FPS_CAP;
        };

        // (2) frame rate: shorten short setTimeout/setInterval delays.
        var      _st = window.setTimeout, _si = window.setInterval;
        function scale(d) {
            var m = window.__UNL_SPEED || 1;
            return (typeof d === 'number' && d > 0 && d < window.__UNL_TIMER_MAX && m > 0) ? d / m : d;
        }
        window.setTimeout = function(fn, d) {
            arguments[1] = scale(d);
            return _st.apply(this, arguments);
        };
        window.setInterval = function(fn, d) {
            arguments[1] = scale(d);
            return _si.apply(this, arguments);
        };

        // --- render rate ------------------------------------------------------------------
        // auto mode watches two signals: how many frames the browser actually presents
        // (requestAnimationFrame in this frame -- Phaser's own loop happily reports 60 while the
        // compositor delivers 10) and how much wall time the loop callback itself eats.
        var auto  = {rate : 30, raf : 0, busy : 0, t0 : 0};
        var stats = {frames : 0};

        (function raf() {
            auto.raf++;
            window.requestAnimationFrame(raf);
        })();

        function renderFps() {
            var cap = window.__UNL_FPS_CAP;
            if(cap < 0) {
                return auto.rate;
            }
            return cap > 0 ? cap : 0; // 0 = uncapped, follow the game's own target
        }

        function tune() {
            var now = window.performance.now();
            var e   = (now - auto.t0) / 1000;
            auto.t0 = now;
            var raf = auto.raf, busy = auto.busy;
            auto.raf = auto.busy = 0;
            if(window.__UNL_FPS_CAP >= 0 || e < 0.3 || document.hidden || raf === 0) {
                return; // not in auto mode, or nothing meaningful to measure
            }
            var fps  = raf / e;
            var load = busy / (e * 1000);
            var r    = auto.rate;
            if(fps < r * 0.9 || load > 0.6) {
                r -= 6; // we are asking for more frames than are reaching the screen
            } else if(fps > r * 0.95 && load < 0.4) {
                r += 6; // headroom to spare
            }
            auto.rate = Math.max(window.__UNL_FPS_MIN, Math.min(window.__UNL_FPS_MAX, r));
        }

        // The loop's own setTimeout goes through the scaled wrapper above, so the delay has to be
        // pre-multiplied by the speed to land on the real interval we want.
        var target0 = null;
        function applyRate() {
            var g = window.game;
            if(!g || !g.loop || !g.loop.raf) {
                return false;
            }
            if(target0 === null) {
                target0 = 1000 / (g.loop.targetFps || 60);
            }
            var r    = renderFps();
            // Uncapped keeps the game's own target delay, which the scaled setTimeout above then
            // divides -- that is the old 60 x speed behaviour, kept as an escape hatch.
            var want = (r > 0) ? Math.round(1000 / r * (window.__UNL_SPEED || 1)) : target0;
            if(g.loop.raf.delay !== want) {
                g.loop.raf.delay = want;
            }
            return true;
        }

        // (1) loop delta: scale the per-frame delta fed to Phaser's subsystems.
        // TimeStep.start() assigns this.callback, so a plain wrap installed before the game boots
        // gets silently thrown away -- hence the accessor, which survives any reassignment.
        // (Do not re-wrap loop.callback from outside: the getter hands back this wrapper, so the
        // usual save-and-wrap pattern makes the setter store your wrapper as the "real" step and
        // recurses forever. Instrument game.scene.update / game.scene.render instead.)
        function hookLoop() {
            var g = window.game;
            if(!g || !g.loop || typeof g.loop.callback !== 'function') {
                return false;
            }
            var loop = g.loop;
            if(loop.__unlHooked) {
                return true;
            }
            var raw     = loop.callback;
            var wrapper = function(time, delta) {
                var t0 = window.performance.now();
                try {
                    var d = delta * (window.__UNL_SPEED || 1);
                    loop.delta = d;
                    stats.frames++;
                    return raw.call(this, time, d);
                } finally {
                    auto.busy += window.performance.now() - t0;
                }
            };
            Object.defineProperty(loop, 'callback', {
                configurable : true,
                get : function() { return wrapper; },
                set : function(v) { raw = v; }
            });
            loop.__unlHooked = true;
            return true;
        }

        // (3) tween ticker: Multiply tween's getDelta() return by the speed.
        function hookTweens() {
            var g = window.game;
            if(!g || !g.scene || !g.scene.scenes) {
                return false;
            }
            var scs = g.scene.scenes;
            for(var i = 0; i < scs.length; i++) {
                var tw = scs[i] && scs[i].tweens;
                if(!tw) {
                    continue;
                }
                var proto = tw;
                while(proto && !Object.prototype.hasOwnProperty.call(proto, 'getDelta')) {
                    proto = Object.getPrototypeOf(proto);
                }
                if(!proto) {
                    continue;
                }
                if(proto.__unlGD) {
                    return true; // already patched (shared prototype)
                }
                var orig       = proto.getDelta;
                proto.getDelta = function(t) {
                    var d = orig.call(this, t);
                    var m = window.__UNL_SPEED || 1;
                    return d * m;
                };
                proto.__unlGD = true;
                return true;
            }
            return false;
        }

        window.__UNL_APPLY = applyRate;
        window.unlightStats = function() {
            return {
                speed : window.__UNL_SPEED,
                cap : window.__UNL_FPS_CAP,
                renderFps : renderFps(),
                rafDelay : window.game && window.game.loop && window.game.loop.raf.delay,
                frames : stats.frames
            };
        };

        var doneL = hookLoop(), doneT = hookTweens();
        if(!doneL || !doneT) {
            var iv = _si.call(window, function() {
                if(!doneL) {
                    doneL = hookLoop();
                }
                if(!doneT) {
                    doneT = hookTweens();
                }
                if(doneL && doneT) {
                    clearInterval(iv);
                }
            }, 100);
            _st.call(window, function() { clearInterval(iv); }, 120000);
        }

        auto.t0 = window.performance.now();
        _si.call(window, applyRate, 500);
        _si.call(window, tune, 750);
    } + ')(' + JSON.stringify(initial) + ', ' + JSON.stringify(initialCap) + ');';

    var s         = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

// Push a setting into the page (robust across content-script/page worlds).
function poke(js) {
    try {
        var sc         = document.createElement('script');
        sc.textContent = js + 'window.__UNL_APPLY&&window.__UNL_APPLY();';
        (document.head || document.documentElement).appendChild(sc);
        sc.remove();
    } catch(e) {
    }
}

function apply(v) {
    poke('window.__UNL_SPEED=' + (Number(v) || 1) + ';');
}

function applyCap(v) {
    poke('window.__UNL_FPS_CAP=' + (Number(v) || 0) + ';');
}

inject(2, -1);
try {
    var p = api.storage.local.get([ 'speed', 'fpsCap' ]);
    var got = function(r) {
        if(!r) {
            return;
        }
        if(typeof r.speed === 'number') apply(r.speed);
        if(typeof r.fpsCap === 'number') applyCap(r.fpsCap);
    };
    if(p && p.then) {
        p.then(got, function() {});
    } else {
        api.storage.local.get([ 'speed', 'fpsCap' ], got);
    }
} catch(e) {
}
api.storage.onChanged.addListener(function(changes, area) {
    if(area !== 'local') {
        return;
    }
    if(changes.speed) {
        apply(changes.speed.newValue);
    }
    if(changes.fpsCap) {
        applyCap(changes.fpsCap.newValue);
    }
});
})();
