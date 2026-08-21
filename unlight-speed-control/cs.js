// The game mixes three independently-timed animation systems, so three knobs are needed:
//   1. Phaser loop delta   -> sprite animations & scene.time timers (delta-based).
//   2. setTimeout frame rate-> the loop runs in setTimeout mode; shortening delays raises fps,
//                              which speeds up frame-counted animations (e.g. screen transitions).
//   3. Tween ticker getDelta-> the game's TweenManager paces itself on Date.now() (real clock),
//                              ignoring the loop entirely; this drives most battle animations.
// All three read window.__UNL_SPEED, so the popup can change speed live.

(function() {
if(location.hostname !== 'www.playunlight-dmm.com' || location.pathname !== '/') {
    return;
}

var api = (typeof browser !== 'undefined') ? browser : chrome;

var injected = false;

function inject(initial) {
    if(injected) {
        return;
    }
    injected = true;

    var code = '(' + function(INIT) {
        if(window.__UNL_HOOK_INSTALLED) {
            if(typeof INIT === 'number' && INIT > 0) window.__UNL_SPEED = INIT;
            return;
        }
        window.__UNL_HOOK_INSTALLED = true;
        window.__UNL_SPEED          = (typeof INIT === 'number' && INIT > 0) ? INIT : 2;
        window.__UNL_TIMER_MAX      = 5000; // leave long (network/session) timers untouched
        window.setUnlightSpeed      = function(x) {
            window.__UNL_SPEED = Number(x) || 1;
            return window.__UNL_SPEED;
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

        // (1) loop delta: scale the per-frame delta fed to Phaser subsystems.
        function hookLoop() {
            var g = window.game;
            if(!g || !g.loop || typeof g.loop.callback !== 'function') {
                return false;
            }
            if(g.loop.__unlHooked) {
                return true;
            }
            var orig           = g.loop.callback;
            g.loop.callback    = function(time, delta) { var m = window.__UNL_SPEED || 1; g.loop.delta = delta * m; return orig(time, delta * m); };
            g.loop.__unlHooked = true;
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
            }, 300);
            _st.call(window, function() { clearInterval(iv); }, 120000);
        }
    } + ')(' + JSON.stringify(initial) + ');';

    var s         = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

// Push a multiplier into the page (robust across content-script/page worlds).
function apply(v) {
    try {
        var sc         = document.createElement('script');
        sc.textContent = 'window.__UNL_SPEED=' + (Number(v) || 1) + ';';
        (document.head || document.documentElement).appendChild(sc);
        sc.remove();
    } catch(e) {
    }
}

inject(2);
try {
    var p = api.storage.local.get('speed');
    if(p && p.then) {
        p.then(function(r) { if (r && typeof r.speed === 'number') apply(r.speed); }, function() {});
    } else {
        api.storage.local.get('speed', function(r) { if (r && typeof r.speed === 'number') apply(r.speed); });
    }
} catch(e) {
}
api.storage.onChanged.addListener(function(changes, area) {
    if(area === 'local' && changes.speed) {
        apply(changes.speed.newValue);
    }
});
})();
