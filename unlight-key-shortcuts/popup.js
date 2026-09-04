var api = (typeof browser !== 'undefined') ? browser : chrome;
var btn = document.getElementById('toggle');

function render(on) {
    btn.textContent = on ? 'Enabled' : 'Disabled';
    btn.className   = on ? 'on' : '';
    btn.dataset.on  = on ? '1' : '';
}

btn.addEventListener('click', function() {
    var on = !btn.dataset.on;
    try {
        api.storage.local.set({keysEnabled : on});
    } catch(e) {
    }
    render(on);
});

function init(r) {
    render(!(r && r.keysEnabled === false));
}

try {
    var p = api.storage.local.get('keysEnabled');
    if(p && p.then) {
        p.then(init, function() { init(); });
    } else {
        api.storage.local.get('keysEnabled', init);
    }
} catch(e) {
    init();
}
