/* ========================================================
   CARPOOL CRITICS — SITE BAR BEHAVIOUR
   The phone menu is a checkbox, so it opens with no script at
   all. This file only adds the ways out that a checkbox cannot
   know about: tapping the page behind it, pressing Escape, and
   choosing an item. Loaded by index.html and every generated
   page, so both surfaces dismiss the same way.
   ======================================================== */
(function () {
  'use strict';

  var toggle = document.getElementById('nav-toggle');
  if (!toggle) return;

  function close() {
    if (toggle.checked) toggle.checked = false;
  }

  // Any tap outside the menu closes it. The dialog is an overlay now, so the
  // page behind it is visible and tappable-looking; a menu that ignores that
  // tap feels broken.
  document.addEventListener('pointerdown', function (event) {
    if (!toggle.checked) return;
    var menu = toggle.parentNode; // .nav-group: the ticket and the stack
    if (menu && menu.contains(event.target)) return;
    close();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') close();
  });

  // Choosing an item should fold the menu away before the view changes.
  document.querySelectorAll('.deck-btn').forEach(function (button) {
    button.addEventListener('click', close);
  });
})();
