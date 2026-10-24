(function () {
    'use strict';

    var THEMES = ['crt', 'xbox', 'win95', 'dos', 'mac'];
    var DEFAULT_THEME = 'clean';
    var STORAGE_KEY = 'cv-theme';

    var root = document.documentElement;
    var themeLink = null;

    function readSaved() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function save(theme) {
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* private mode etc. */ }
    }

    function applyStylesheet(theme) {
        if (theme === DEFAULT_THEME) {
            if (themeLink) themeLink.removeAttribute('href');
            return;
        }
        if (!themeLink) {
            themeLink = document.createElement('link');
            themeLink.rel = 'stylesheet';
            themeLink.id = 'theme-css';
            document.head.appendChild(themeLink); // last in <head>, so it overrides styles.css
        }
        themeLink.href = 'css/themes/' + theme + '.css';
    }

    function setTheme(theme) {
        // Anything unknown (e.g. a theme you've since removed) falls back to the default
        if (theme !== DEFAULT_THEME && THEMES.indexOf(theme) === -1) theme = DEFAULT_THEME;
        root.setAttribute('data-theme', theme);
        applyStylesheet(theme);
        return theme;
    }

    // Runs immediately (script is in <head>): swaps the stylesheet before first paint.
    var current = setTheme(readSaved() || DEFAULT_THEME);

    document.addEventListener('DOMContentLoaded', function () {
        var select = document.getElementById('theme-select');
        if (!select) return;

        // The default state shows the "CHOOSE OS" placeholder
        function showSelection() {
            select.value = current === DEFAULT_THEME ? '' : current;
        }

        showSelection();

        select.addEventListener('change', function () {
            current = setTheme(this.value || DEFAULT_THEME);
            save(current);
            showSelection(); // picking CLEAN snaps the dropdown back to "CHOOSE OS"
        });
    });
})();