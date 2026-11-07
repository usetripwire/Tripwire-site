(function () {
  var c = window.TRIPWIRE_CONFIG || {};
  if (!c.contact) return;
  document.querySelectorAll("[data-contact]").forEach(function (a) {
    a.href = "mailto:" + c.contact;
    a.textContent = c.contact;
  });
})();
