// src/js/y-metrika.js

(function (m, e, t, r, i, k, a) {
	m[i] =
		m[i] ||
		function () {
			(m[i].a = m[i].a || []).push(arguments);
		};
	m[i].l = 1 * new Date();
	var z = e.createElement(t),
		p = e.getElementsByTagName(t)[0];
	(k = m.Promise),
		(a = p.parentNode),
		(function () {
			var s = function () {
				z.async = true;
				z.src = r;
				a.insertBefore(z, p);
			};
			if (k) {
				k.resolve().then(s);
			} else {
				s();
			}
		})();
})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

var metrikaId = 104313731;

var initMetrika = function () {
	ym(metrikaId, "init", {
		clickmap: true,
		trackLinks: true,
		accurateTrackBounce: true,
		webvisor: true,
	});

	[
		"scroll",
		"mousemove",
		"touchmove",
		"touchstart",
		"click",
		"keydown",
	].forEach(function (e) {
		window.removeEventListener(e, initMetrika, { passive: true });
	});
};

["scroll", "mousemove", "touchmove", "touchstart", "click", "keydown"].forEach(
	function (e) {
		window.addEventListener(e, initMetrika, { passive: true, once: true });
	}
);
