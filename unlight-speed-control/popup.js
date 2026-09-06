var api  = (typeof browser !== 'undefined') ? browser : chrome;
var btns = document.getElementById('btns');
var hint = document.getElementById('hint');
var els  = {};

var fpsRow  = document.getElementById('fps');
var fpsHint = document.getElementById('fpshint');
var fpsEls  = {};
var CAPS    = [ -1, 24, 30, 60, 0 ];

[1, 2, 3, 4, 5].forEach(function(v) {
    var b         = document.createElement('button');
    b.textContent = 'x' + v;
    b.addEventListener('click', function() { setSpeed(v); });
    btns.appendChild(b);
    els[v] = b;
});

CAPS.forEach(function(v) {
    var b         = document.createElement('button');
    b.textContent = (v < 0) ? 'auto' : (v ? String(v) : 'off');
    b.addEventListener('click', function() { setCap(v); });
    fpsRow.appendChild(b);
    fpsEls[v] = b;
});

function render(v) {
    [1, 2, 3, 4, 5].forEach(function(k) {
        els[k].className = (k === v) ? 'sel' : '';
    });
    hint.textContent = (v === 1) ? 'Normal speed' : ('Game runs ' + v + '× faster');
}

function renderCap(v) {
    CAPS.forEach(function(k) {
        fpsEls[k].className = (k === v) ? 'sel' : '';
    });
    // Delta- and tween-based animation is unaffected by this; only frame-counted animation
    // (a few menu transitions) follows the render rate.
    fpsHint.textContent = (v < 0)  ? 'Follows what the screen keeps up with'
                        : v        ? ('Loop pinned to ' + v + ' fps')
                                   : 'Uncapped (60 × speed)';
}

function setSpeed(v) {
    try {
        api.storage.local.set({speed : v});
    } catch(e) {
    }
    render(v);
}

function setCap(v) {
    try {
        api.storage.local.set({fpsCap : v});
    } catch(e) {
    }
    renderCap(v);
}

function init(r) {
    render((r && typeof r.speed === 'number') ? r.speed : 2);
    renderCap((r && typeof r.fpsCap === 'number') ? r.fpsCap : -1);
}

try {
    var p = api.storage.local.get([ 'speed', 'fpsCap' ]);
    if(p && p.then) {
        p.then(init, function() { init(); });
    } else {
        api.storage.local.get([ 'speed', 'fpsCap' ], init);
    }
} catch(e) {
    init();
}
