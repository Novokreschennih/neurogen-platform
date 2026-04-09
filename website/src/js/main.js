/**
 * SetHubble - Main Shared Script
 * Version: 8.3 (Progress + Copy Code + Back to Top)
 * Описание: Этот скрипт содержит общую логику для всего сайта:
 * тема, переключатели, якоря, лайтбокс, кнопка "Наверх", прогресс чтения и копирование кода.
 */
document.addEventListener("DOMContentLoaded", function () {
	// --- 1. Переключатель темы ---
	const themeToggle = document.getElementById("theme-toggle");
	if (themeToggle) {
		themeToggle.addEventListener("click", () => {
			const htmlEl = document.documentElement;
			if (htmlEl.classList.contains("light-theme")) {
				htmlEl.classList.remove("light-theme");
				localStorage.setItem("theme", "dark");
			} else {
				htmlEl.classList.add("light-theme");
				localStorage.setItem("theme", "light");
			}
			if (typeof window.renderSimulator === "function") {
				setTimeout(() => window.renderSimulator(), 50);
			}
		});
	}

	// --- 2. Переключатель ролей "Автор/Партнер" ---
	const audienceTriggers = document.querySelector(".audience-triggers");
	if (audienceTriggers) {
		audienceTriggers.addEventListener("click", (e) => {
			const trigger = e.target.closest(".audience-trigger");
			if (!trigger || trigger.classList.contains("active")) return;

			audienceTriggers.querySelector(".active")?.classList.remove("active");
			document
				.querySelector(".audience-content.active")
				?.classList.remove("active");

			trigger.classList.add("active");
			const content = document.getElementById(trigger.dataset.target);
			if (content) {
				content.classList.add("active");
			}
		});
	}

	// --- 3. Ссылки-якоря, ведущие к калькулятору ---
	const pathLinks = document.querySelectorAll(".path-link");
	const simulatorSection = document.getElementById("simulator");
	if (pathLinks.length && simulatorSection) {
		pathLinks.forEach((link) => {
			link.addEventListener("click", function (event) {
				event.preventDefault();
				if (typeof window.setSimulatorMode === "function") {
					window.setSimulatorMode(this.dataset.mode);
				}
				simulatorSection.scrollIntoView({ behavior: "smooth", block: "start" });
			});
		});
	}

	// --- 4. Кнопка "Наверх" ---
	const backToTop = document.getElementById("backToTop");
	if (backToTop) {
		const toggleBackToTop = () => {
			if (window.scrollY > 300) {
				backToTop.classList.add("visible");
			} else {
				backToTop.classList.remove("visible");
			}
		};
		window.addEventListener("scroll", toggleBackToTop);
		toggleBackToTop();
	}

	// --- 5. Прогресс чтения ---
	const progressBar = document.getElementById("readingProgress");
	if (progressBar) {
		const updateProgress = () => {
			const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
			const scrolled = (window.scrollY / windowHeight) * 100;
			progressBar.style.width = scrolled + "%";
		};
		window.addEventListener("scroll", updateProgress);
		updateProgress();
	}

	// --- 6. Кнопка копирования кода ---
	const codeBlocks = document.querySelectorAll("pre[class*='language-']");
	codeBlocks.forEach((block) => {
		const button = document.createElement("button");
		button.className = "copy-code-btn";
		button.innerHTML = `
			<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
			<span>Копировать</span>
		`;
		block.appendChild(button);

		button.addEventListener("click", async () => {
			const code = block.querySelector("code")?.textContent || "";
			try {
				await navigator.clipboard.writeText(code);
				button.classList.add("copied");
				button.innerHTML = `
					<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
					<span>Скопировано!</span>
				`;
				setTimeout(() => {
					button.innerHTML = `
						<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
						<span>Копировать</span>
					`;
					button.classList.remove("copied");
				}, 2000);
			} catch (err) {
				console.error("Не удалось скопировать:", err);
			}
		});
	});

	// --- 7. ЛАЙТБОКС ---
	const lightboxTriggers = document.querySelectorAll("a.lightbox-trigger");
	if (lightboxTriggers.length > 0) {
		const lightbox = document.createElement("div");
		lightbox.id = "lightbox";

		const lightboxImage = document.createElement("img");
		const closeButton = document.createElement("span");
		closeButton.id = "lightbox-close";
		closeButton.innerHTML = "&times;";

		lightbox.appendChild(lightboxImage);
		lightbox.appendChild(closeButton);
		document.body.appendChild(lightbox);

		const closeLightbox = () => {
			lightbox.classList.remove("active");
		};

		lightboxTriggers.forEach((trigger) => {
			trigger.addEventListener("click", function (e) {
				e.preventDefault();
				lightboxImage.src = this.href;
				lightbox.classList.add("active");
			});
		});

		closeButton.addEventListener("click", closeLightbox);
		lightbox.addEventListener("click", (e) => {
			if (e.target === e.currentTarget) {
				closeLightbox();
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				closeLightbox();
			}
		});
	}
});
