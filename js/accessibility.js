/*
 * Accessibility panel
 *
 * Controls (all remembered in localStorage):
 *   - Text size: 100% to 200% in steps, applied as the --text-scale CSS variable
 *   - Dyslexia-friendly font: sets data-dyslexia="on" on <html> (see css/styles.css)
 *   - Reduce motion: sets data-motion="reduced" on <html>; also starts on if the
 *     visitor's operating system already asks for reduced motion
 *
 * Like theme.js this is loaded in <head> WITHOUT defer, so saved settings are
 * applied before first paint. The panel's markup lives in index.html; this file
 * only wires it up. None of this touches the PDF export, which only reads text.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'cv-a11y';
    var SCALES = [100, 115, 130, 150, 175, 200]; // percent
    var DEFAULTS = { scaleIndex: 0, dyslexia: false, motion: null }; // motion: null = follow the OS

    var root = document.documentElement;
    var osReducesMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var state = load();

    function load() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* ignore */ }
        saved = saved && typeof saved === 'object' ? saved : {};
        var idx = parseInt(saved.scaleIndex, 10);
        return {
            scaleIndex: idx >= 0 && idx < SCALES.length ? idx : DEFAULTS.scaleIndex,
            dyslexia: saved.dyslexia === true,
            motion: saved.motion === true || saved.motion === false ? saved.motion : DEFAULTS.motion
        };
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
    }

    function motionReduced() {
        return osReducesMotion || state.motion === true;
    }

    // Applies state to the page. Safe to run before the body exists.
    function apply() {
        root.style.setProperty('--text-scale', String(SCALES[state.scaleIndex] / 100));
        if (state.dyslexia) root.setAttribute('data-dyslexia', 'on'); else root.removeAttribute('data-dyslexia');
        if (motionReduced()) root.setAttribute('data-motion', 'reduced'); else root.removeAttribute('data-motion');
    }

    apply();

    document.addEventListener('DOMContentLoaded', function () {
        var toggle = document.getElementById('a11y-toggle');
        var panel = document.getElementById('a11y-panel');
        if (!toggle || !panel) return;

        var smaller = document.getElementById('a11y-smaller');
        var larger = document.getElementById('a11y-larger');
        var sizeValue = document.getElementById('a11y-size-value');
        var dyslexiaBtn = document.getElementById('a11y-dyslexia');
        var motionBtn = document.getElementById('a11y-motion');
        var resetBtn = document.getElementById('a11y-reset');
        var status = document.getElementById('a11y-status');

        function announce(message) {
            if (!status) return;
            status.textContent = ''; // clear first so repeating a message is still announced
            setTimeout(function () { status.textContent = message; }, 50);
        }

        function setSwitch(btn, on, suffix) {
            btn.setAttribute('aria-checked', on ? 'true' : 'false');
            var label = btn.querySelector('.a11y-state');
            if (label) label.textContent = (on ? 'On' : 'Off') + (suffix || '');
        }

        function render() {
            sizeValue.textContent = SCALES[state.scaleIndex] + '%';
            smaller.setAttribute('aria-disabled', state.scaleIndex === 0 ? 'true' : 'false');
            larger.setAttribute('aria-disabled', state.scaleIndex === SCALES.length - 1 ? 'true' : 'false');
            setSwitch(dyslexiaBtn, state.dyslexia);

            // If the OS already asks for less motion, that wins and the switch just reports it.
            setSwitch(motionBtn, motionReduced(), osReducesMotion ? ' (system)' : '');
            motionBtn.setAttribute('aria-disabled', osReducesMotion ? 'true' : 'false');
        }

        function change(message) {
            apply();
            render();
            save();
            if (message) announce(message);
        }

        function setOpen(open, returnFocus) {
            panel.hidden = !open;
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (!open && returnFocus) toggle.focus();
        }

        toggle.addEventListener('click', function () {
            setOpen(panel.hidden);
        });

        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') setOpen(false, true);
        });

        smaller.addEventListener('click', function () {
            if (state.scaleIndex === 0) return;
            state.scaleIndex--;
            change('Text size ' + SCALES[state.scaleIndex] + ' percent');
        });

        larger.addEventListener('click', function () {
            if (state.scaleIndex === SCALES.length - 1) return;
            state.scaleIndex++;
            change('Text size ' + SCALES[state.scaleIndex] + ' percent');
        });

        dyslexiaBtn.addEventListener('click', function () {
            state.dyslexia = !state.dyslexia;
            change('Dyslexia-friendly font ' + (state.dyslexia ? 'on' : 'off'));
        });

        motionBtn.addEventListener('click', function () {
            if (osReducesMotion) return;
            state.motion = !motionReduced();
            change('Reduce motion ' + (state.motion ? 'on' : 'off'));
        });

        resetBtn.addEventListener('click', function () {
            state.scaleIndex = DEFAULTS.scaleIndex;
            state.dyslexia = DEFAULTS.dyslexia;
            state.motion = DEFAULTS.motion;
            change('Accessibility settings reset');
        });

        render();
    });
})();