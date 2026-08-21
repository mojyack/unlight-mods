var api  = (typeof browser !== 'undefined') ? browser : chrome;
var btns = document.getElementById('btns');
var hint = document.getElementById('hint');
var els  = {};

[1, 2, 3, 4, 5].forEach(function(v) {
    var b         = document.createElement('button');
    b.textContent = 'x' + v;
    b.addEventListener('click', function() { setSpeed(v); });
    btns.appendChild(b);
    els[v] = b;
});

function render(v) {
    [1, 2, 3, 4, 5].forEach(function(k) {
        els[k].className = (k === v) ? 'sel' : '';
    });
    hint.textContent = (v === 1) ? 'Normal speed' : ('Game runs ' + v + '× faster');
}

function setSpeed(v) {
    try {
        api.storage.local.set({speed : v});
    } catch(e) {
    }
    render(v);
}

function init(r) {
    var v = (r && typeof r.speed === 'number') ? r.speed : 2;
    render(v);
}

try {
    var p = api.storage.local.get('speed');
    if(p && p.then) {
        p.then(init, function() { init(); });
    } else {
        api.storage.local.get('speed', init);
    }
} catch(e) {
    init();
}
