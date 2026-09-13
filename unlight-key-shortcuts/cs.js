// Keyboard control for UNLIGHT:Revive battles.
//
// The battle UI is a Phaser canvas, so there is nothing focusable to tab through; instead we
// drive the very same GameObjects a mouse click would hit, by emitting their pointer events:
//   MainA.player_card[i].card_image  "pointerup" -> socket "card_submit" / "card_rotate"
//   MainA.decide_btn                 "pointerup"  -> socket "player_ready"
//   MainA.card_page_prev/next        "click"      -> hand paging
//   MovePhaseA.select_{front,change,stay,back} "pointerup" -> socket "move_select"
// A card object knows which row it is in by itself (get_card_state(): HAND / CLICKED), and the
// game lays each row out by x, so the cursor order is just "sorted by x".
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

// card.get_card_state() values, from the game's own enum {NONE:0, HAND:1, CLICKED:2, BROKEN:3}.
var HAND     = 1; // cards waiting in hand
var STAGED   = 2; // cards commited to the staging area
var CURSOR_C = 0xffd45e;

var zone   = HAND; // which row the cursor is on
var sel    = -1;   // player_card index under the cursor (-1 = nothing yet)
var pos    = 0;    // remembered column, so switching rows keeps the place
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

function fire(o, name, lx, ly) {
    o.emit(name, pointerOf(o), lx || 0, ly || 0, {stopPropagation : function() {}});
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

function cardOf(s, i) {
    return (s && s.player_card && i >= 0) ? s.player_card[i] : null;
}

function playable(card) {
    return !!(card && card.card_image && card.card_interactive === true && usable(card.card_image));
}

// One card object handles both actions from a single `pointerup`, telling them apart by where
// the pointer landed: inside the 22x22 box at the middle of the card it flips (card_rotate),
// anywhere else it commits or uncommits (card_submit). Local coordinates run from the card's
// top-left corner, so the middle is (width/2, height/2) and (0,0) is safely outside the box.
function act(s, card, flip) {
    if(!playable(card) || s.card_page_sliding === true) {
        return false;
    }
    var img = card.card_image;
    fire(img, 'pointerup', flip ? img.width / 2 : 0, flip ? img.height / 2 : 0);
    return true;
}

// player_card indices whose card is in row `state`, ordered left to right -- the same order the
// game itself uses when it re-lays a row out. Reading the state (rather than the y coordinate)
// keeps the cursor steady while a card tweens between the two rows: the game flips the state
// before starting the tween, so a card counts as gone from its old row on the very first frame.
function row(s, state) {
    var out = [];
    if(!s || !s.player_card) {
        return out;
    }
    for(var i = 0; i < s.player_card.length; i++) {
        var c = s.player_card[i];
        if(c && typeof c.get_card_state === 'function' && c.get_card_state() === state) {
            out.push(i);
        }
    }
    out.sort(function(a, b) { return s.player_card[a].x - s.player_card[b].x; });
    return out;
}

// Keep `sel`/`pos` pointing at something that still exists.
function sync(s) {
    var list = row(s, zone);
    if(list.length === 0) {
        var other = (zone === HAND) ? STAGED : HAND;
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
// at `202 + 60*ordinal - 540*(card_page_now-1)`, so the page a card lives on follows from its
// ordinal alone -- reading x would be wrong while the layout tween is still running.
var PAGE_SIZE = 9;

function pageOf(ordinal) {
    return Math.floor(ordinal / PAGE_SIZE) + 1;
}

// One page step towards `want`. The arrow's own handler only refuses while a slide is playing,
// so the range check is ours to make.
function gotoPage(s, want) {
    var now = s.card_page_now || 1;
    if(want < 1 || want > (s.card_page_max || 1) || want === now || s.card_page_sliding === true) {
        return false;
    }
    var arrow = (want < now) ? s.card_page_prev : s.card_page_next;
    if(!arrow || arrow.active === false) {
        return false;
    }
    arrow.emit('click', arrow);
    return true;
}

function keepVisible(s) {
    if(zone === HAND && sel >= 0) {
        gotoPage(s, pageOf(pos));
    }
}

// q / e: turn the page and put the cursor on the first card of the page we land on.
function turnPage(s, dir) {
    if(zone !== HAND) {
        return;
    }
    var want = (s.card_page_now || 1) + dir;
    if(!gotoPage(s, want)) {
        return;
    }
    var list = row(s, zone);
    pos      = Math.min((want - 1) * PAGE_SIZE, list.length - 1);
    sel      = list[pos];
}

function drawCursor(s) {
    var card = cardOf(s, sel);
    if(!s || !card || !window.__ULKS_ENABLED) {
        if(cursor) {
            cursor.setVisible(false);
        }
        return;
    }
    if(!cursor || cursor.scene !== s || cursor.active === false) {
        cursor = s.add.rectangle(0, 0, 62, 92).setStrokeStyle(3, CURSOR_C).setDepth(60);
    }
    cursor.setPosition(card.x, card.y).setVisible(true);
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
    var other = (zone === HAND) ? STAGED : HAND;
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
            press(mv['select_' + name], [ 'pointerup' ]);
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
        act(s, cardOf(s, sel), false);
        return true;
    case 'ArrowDown':
        sync(s);
        act(s, cardOf(s, sel), true);
        return true;
    case 'Enter':
        press(s.decide_btn, [ 'pointerup' ]);
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
