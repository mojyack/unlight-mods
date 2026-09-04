// Keyboard control for UNLIGHT:Revive battles.
//
// The battle UI is a Phaser canvas, so there is nothing focusable to tab through; instead we
// drive the very same GameObjects a mouse click would hit, by emitting their pointer events:
//   MainA.arr1[i][0]  "pointerdown"           -> socket "card"        (commit / uncommit)
//   MainA.button[i]   "pointerdown","pointerup" -> socket "rotate"    (flip a card)
//   MainA.ok          "pointerdown"           -> socket "I_am_ok"     (finish selection)
//   MovePhaseA.{front,change,stay,back} "pointerdown" -> socket "move_select"
// A card sits in the hand at y=510 and in the staging (commited) area at y=380; the game
// re-lays both rows out by x, so the cursor order is just "sorted by x".
//
// The game lives in a nested cross-origin iframe, so the outer DMM frames only relay keydown
// events down the frame tree; all the real work happens in the injected page script.

(function() {
var GAME_HOST = 'www.playunlight-dmm.com';
var api       = (typeof browser !== 'undefined') ? browser : chrome;

// ---- relay: outer frames just forward keys to the game frame ----
if(location.hostname !== GAME_HOST) {
    window.addEventListener('keydown', function(e) {
        var msg = {__ulks_key : {key : e.key, ctrl : e.ctrlKey, alt : e.altKey, meta : e.metaKey, shift : e.shiftKey}};
        (function walk(w, d) {
            var n = 0;
            try {
                n = w.frames.length;
            } catch(err) {
                return;
            }
            for(var i = 0; i < n; i++) {
                try {
                    w.frames[i].postMessage(msg, '*');
                } catch(err) {
                }
                if(d < 4) {
                    try { walk(w.frames[i], d + 1); } catch(err) {}
                }
            }
        })(window, 0);
    }, true);
    return;
}
if(location.pathname !== '/') {
    return;
}

var code = '(' + function(INIT) {
if(window.__ULKS_HOOK) {
    window.__ULKS_ENABLED = INIT !== false;
    return;
}
window.__ULKS_HOOK    = true;
window.__ULKS_ENABLED = INIT !== false;

var HAND_Y   = 510; // cards waiting in hand
var STAGE_Y  = 380; // cards commited to the staging area
var CURSOR_C = 0xffd45e;

var zone   = HAND_Y; // which row the cursor is on
var sel    = -1;     // arr1 index under the cursor (-1 = nothing yet)
var pos    = 0;      // remembered column, so switching rows keeps the place
var cursor = null;

function scene(key) {
    var g = window.game;
    if(!g || !g.scene || !g.scene.keys) {
        return null;
    }
    var s = g.scene.keys[key];
    return (s && s.sys && s.sys.settings && s.sys.settings.active) ? s : null;
}

function usable(o) {
    return !!(o && o.input && o.input.enabled && o.visible && o.active !== false);
}

function pointerOf(o) {
    try { return o.scene.input.activePointer; } catch(e) { return undefined; }
}

function fire(o, name) {
    o.emit(name, pointerOf(o), 0, 0, {stopPropagation : function() {}});
}

// Fire a GameObject's own pointer handlers, exactly as a real click would.
function press(o, events) {
    if(!usable(o)) {
        return false;
    }
    for(var i = 0; i < events.length; i++) {
        fire(o, events[i]);
    }
    return true;
}

// The game assumes a mouse, i.e. that hovering always precedes clicking: a card's pointerdown
// handler dereferences `info_text_timeout`, which nothing but pointerover ever creates (it
// starts out undefined, and the handler only guards against null -- so clicking an unhovered
// card throws before it can send anything). Hovering is also what makes the flip button
// visible. So bracket every card action in the hover a mouse would have provided.
function hovered(card, act) {
    if(!usable(card)) {
        return false;
    }
    fire(card, 'pointerover');
    var done = act();
    fire(card, 'pointerout');
    return done;
}

// arr1 indices sitting on row `y`, ordered left to right.
//
// The y test is deliberately exact. A card being (un)commited tweens x and y together, and it
// overtakes its right-hand neighbour in x about a quarter of the way through -- so any y
// tolerance wide enough to still count it there would reorder the row and leave `pos` one slot
// too far right once the card finally leaves. Exact matching drops it on the tween's first
// frame, well before the crossover, so the cursor stays on the slot the user acted on.
function row(s, y) {
    var out = [];
    if(!s || !s.arr1) {
        return out;
    }
    for(var i = 0; i < s.arr1.length; i++) {
        var c = s.arr1[i];
        if(c && c[0] && Math.round(c[0].y) === y) {
            out.push(i);
        }
    }
    out.sort(function(a, b) { return s.arr1[a][0].x - s.arr1[b][0].x; });
    return out;
}

// Keep `sel`/`pos` pointing at something that still exists.
function sync(s) {
    var list = row(s, zone);
    if(list.length === 0) {
        var other = (zone === HAND_Y) ? STAGE_Y : HAND_Y;
        if(row(s, other).length > 0) {
            zone = other;
            list = row(s, zone);
        }
    }
    if(list.length === 0) {
        sel = -1;
        return list;
    }
    var at = list.indexOf(sel);
    if(at < 0) {
        at  = Math.min(pos, list.length - 1);
        sel = list[at];
    }
    pos = at;
    return list;
}

// The hand shows PAGE_SIZE cards at a time and scrolls in steps of 540px. Cards are laid out
// at `203 + 60*ordinal - 540*(currentPage-1)`, so the page a card lives on follows from its
// ordinal alone -- reading x would be wrong while the layout tween is still running.
var PAGE_SIZE = 9;

function pageOf(ordinal) {
    return Math.floor(ordinal / PAGE_SIZE) + 1;
}

// One page step towards `want` (the arrows disable themselves until their tween ends,
// so stepping more than once per keypress would be dropped anyway).
function gotoPage(s, want) {
    var now = s.currentPage || 1;
    if(now > want) {
        return press2(s, s.arrow_left, -1);
    }
    if(now < want) {
        return press2(s, s.arrow_right, 1);
    }
    return false;
}

function press2(s, arrow, dir) {
    if(!usable(arrow)) {
        return false;
    }
    s.change_page(arrow, dir);
    return true;
}

function keepVisible(s) {
    if(zone === HAND_Y && sel >= 0) {
        gotoPage(s, pageOf(pos));
    }
}

// q / e: turn the page and put the cursor on the first card of the page we land on.
function turnPage(s, dir) {
    if(zone !== HAND_Y) {
        return;
    }
    var want = (s.currentPage || 1) + dir;
    if(want < 1 || !gotoPage(s, want)) {
        return;
    }
    var list = row(s, zone);
    pos      = Math.min((want - 1) * PAGE_SIZE, list.length - 1);
    sel      = list[pos];
}

function drawCursor(s) {
    if(!s || sel < 0 || !window.__ULKS_ENABLED) {
        if(cursor) {
            cursor.setVisible(false);
        }
        return;
    }
    if(!cursor || cursor.scene !== s || cursor.active === false) {
        cursor = s.add.rectangle(0, 0, 62, 92).setStrokeStyle(3, CURSOR_C).setDepth(60);
    }
    var c = s.arr1[sel][0];
    cursor.setPosition(c.x, c.y).setVisible(true);
}

function tick() {
    var s = scene('MainA');
    if(!s) {
        cursor = null;
        sel    = -1;
        return;
    }
    sync(s);
    drawCursor(s);
}

function moveCursor(s, delta) {
    var list = sync(s);
    if(list.length === 0) {
        return;
    }
    pos = Math.max(0, Math.min(list.length - 1, pos + delta));
    sel = list[pos];
    keepVisible(s);
}

function toggleZone(s) {
    var other = (zone === HAND_Y) ? STAGE_Y : HAND_Y;
    if(row(s, other).length === 0) {
        return;
    }
    zone = other;
    sel  = -1; // sync() will re-pick using the remembered column
    sync(s);
    keepVisible(s);
}

var MOVES = {z : 'back', x : 'stay', c : 'change', v : 'front'};

function handle(key) {
    if(!window.__ULKS_ENABLED) {
        return false;
    }

    var mv = scene('MovePhaseA');
    if(mv) {
        var name = MOVES[String(key).toLowerCase()];
        if(name) {
            press(mv[name], [ 'pointerdown' ]);
            return true; // swallow the key even when the option is forbidden
        }
    }

    var s = scene('MainA');
    if(!s) {
        return false;
    }

    switch(key) {
    case 'Tab':
        toggleZone(s);
        return true;
    case 'ArrowRight':
        moveCursor(s, 1);
        return true;
    case 'ArrowLeft':
        moveCursor(s, -1);
        return true;
    case 'ArrowUp':
    case ' ':
        sync(s);
        if(sel >= 0) {
            hovered(s.arr1[sel][0], function() { return press(s.arr1[sel][0], [ 'pointerdown' ]); });
        }
        return true;
    case 'ArrowDown':
        sync(s);
        if(sel >= 0 && s.button) {
            hovered(s.arr1[sel][0], function() { return press(s.button[sel], [ 'pointerdown', 'pointerup' ]); });
        }
        return true;
    case 'Enter':
        press(s.ok, [ 'pointerdown' ]);
        return true;
    case 'q':
    case 'Q':
        sync(s);
        turnPage(s, -1);
        return true;
    case 'e':
    case 'E':
        sync(s);
        turnPage(s, 1);
        return true;
    }
    if(key >= '1' && key <= '9') {
        var list = sync(s);
        var at   = Number(key) - 1;
        if(at < list.length) {
            pos = at;
            sel = list[at];
            keepVisible(s);
        }
        return true;
    }
    return false;
}

function onKey(e) {
    if(e.ctrlKey || e.altKey || e.metaKey) {
        return;
    }
    if(handle(e.key)) {
        e.preventDefault();
        e.stopPropagation();
    }
}

window.addEventListener('keydown', onKey, true);
window.addEventListener('message', function(e) {
    var k = e.data && e.data.__ulks_key;
    if(!k || k.ctrl || k.alt || k.meta) {
        return;
    }
    handle(k.key);
}, false);

(function attach() {
    var g = window.game;
    if(g && g.events) {
        g.events.on('poststep', tick);
        return;
    }
    setTimeout(attach, 300);
})();
} + ')(' + JSON.stringify(initialEnabled()) + ');';

function initialEnabled() {
    return true;
}

function injectScript(text) {
    var s         = document.createElement('script');
    s.textContent = text;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
}

injectScript(code);

function apply(v) {
    injectScript('window.__ULKS_ENABLED=' + (v === false ? 'false' : 'true') + ';');
}

try {
    var p = api.storage.local.get('keysEnabled');
    if(p && p.then) {
        p.then(function(r) { if(r && typeof r.keysEnabled === 'boolean') apply(r.keysEnabled); }, function() {});
    } else {
        api.storage.local.get('keysEnabled', function(r) { if(r && typeof r.keysEnabled === 'boolean') apply(r.keysEnabled); });
    }
} catch(e) {
}
api.storage.onChanged.addListener(function(changes, area) {
    if(area === 'local' && changes.keysEnabled) {
        apply(changes.keysEnabled.newValue);
    }
});
})();
