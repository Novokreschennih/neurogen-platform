/**
 * NeuroGen / SetHubble - 3-Block High Converting Calculator
 * Version: 9.0 (Marketing Optimized)
 */

document.addEventListener("DOMContentLoaded", function () {
	const simulatorNode = document.getElementById("simulator");
	if (!simulatorNode) return;

	if (typeof Chart === "undefined") {
		console.error("Chart.js is not loaded.");
		const err = document.getElementById("chart-error");
		if (err) err.classList.remove("hidden");
		return;
	}

	initCalculatorUI();
});

function initCalculatorUI() {
	// --- НАВИГАЦИЯ (Вкладки) ---
	const tabs = document.querySelectorAll(".calc-tab-btn");
	const blocks = document.querySelectorAll(".calc-block");

	tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			// Убираем активный класс у всех
			tabs.forEach((t) => {
				t.classList.remove(
					"active",
					"text-white",
					"bg-white/10",
					"border",
					"border-white/10",
				);
				t.classList.add("text-gray-500");
			});
			blocks.forEach((b) => {
				b.classList.add("hidden");
				b.classList.remove("active", "animate-fade-in");
			});

			// Включаем нужный
			tab.classList.add(
				"active",
				"text-white",
				"bg-white/10",
				"border",
				"border-white/10",
			);
			tab.classList.remove("text-gray-500");

			const target = document.getElementById(tab.dataset.target);
			target.classList.remove("hidden");
			// Небольшой хак для анимации
			setTimeout(() => target.classList.add("active", "animate-fade-in"), 10);

			// Перерисовка графика если открыт 3 блок
			if (tab.dataset.target === "calc-block-3") {
				calculateBlock3();
			}
		});
	});

	// --- СЛУШАТЕЛИ ПОЛЗУНКОВ ---
	const attachSlider = (id, valId, calcFunc, prefix = "", suffix = "") => {
		const slider = document.getElementById(id);
		const valSpan = document.getElementById(valId);
		if (!slider || !valSpan) return;

		slider.addEventListener("input", (e) => {
			const val = parseInt(e.target.value).toLocaleString("ru-RU");
			valSpan.textContent = `${prefix}${val}${suffix}`;
			calcFunc();
		});
	};

	// Блок 1
	attachSlider("slider-b1-budget", "val-b1-budget", calculateBlock1, "", " ₽");
	attachSlider("slider-b1-check", "val-b1-check", calculateBlock1, "", " ₽");
	attachSlider("slider-b1-percent", "val-b1-percent", calculateBlock1, "", "%");

	// Блок 2
	attachSlider(
		"slider-b2-clients",
		"val-b2-clients",
		calculateBlock2,
		"",
		" чел.",
	);
	attachSlider("slider-b2-conv", "val-b2-conv", calculateBlock2, "", "%");
	attachSlider("slider-b2-spend", "val-b2-spend", calculateBlock2, "", " USDT");

	// Блок 3
	attachSlider(
		"slider-b3-direct",
		"val-b3-direct",
		calculateBlock3,
		"",
		" чел.",
	);
	attachSlider("slider-b3-viral", "val-b3-viral", calculateBlock3, "", "");

	// Инициализация расчетов
	calculateBlock1();
	calculateBlock2();
	// Block 3 инициализируется при клике на таб (или можно сразу)
	calculateBlock3();
}

// --- ЛОГИКА БЛОКА 1 (Мертвый бюджет) ---
function calculateBlock1() {
	const budget = parseInt(document.getElementById("slider-b1-budget").value);
	const check = parseInt(document.getElementById("slider-b1-check").value);
	const percent = parseInt(document.getElementById("slider-b1-percent").value);

	// Классика: потрачено = budget, выручка = 0 (гарантий нет)
	document.getElementById("res-b1-classic-spend").textContent =
		budget.toLocaleString("ru-RU");

	// SetHubble: потрачено = budget (выплачено агентам).
	// Выручка = (budget / percent) * 100
	const guaranteedRevenue = (budget / percent) * 100;

	document.getElementById("res-b1-sh-spend").textContent =
		budget.toLocaleString("ru-RU");
	document.getElementById("res-b1-sh-revenue").textContent =
		guaranteedRevenue.toLocaleString("ru-RU");
}

// --- ЛОГИКА БЛОКА 2 (Эффект мультипликатора) ---
function calculateBlock2() {
	const clients = parseInt(document.getElementById("slider-b2-clients").value);
	const conv = parseInt(document.getElementById("slider-b2-conv").value) / 100;
	const spend = parseInt(document.getElementById("slider-b2-spend").value);
	const usdToRub = 95; // Примерный курс
	const avgCommission = 0.02; // 2% в среднем с чужих покупок по сети

	const digitized = clients * conv;
	const turnover = digitized * spend;
	const passiveUsdt = turnover * avgCommission;
	const passiveRub = passiveUsdt * usdToRub;

	animateValue("res-b2-income", passiveUsdt, 0);
	animateValue("res-b2-rub", passiveRub, 0);
}

// --- ЛОГИКА БЛОКА 3 (Агентская лавина) ---
let networkChartInstance = null;

function calculateBlock3() {
	const direct = parseInt(document.getElementById("slider-b3-direct").value);
	const viral = parseInt(document.getElementById("slider-b3-viral").value);
	const avgProfitPerAgent = 5; // $5 комиссии в среднем с каждого человека в глубине

	let labels = [];
	let dataFree = [];
	let dataPro = [];

	let currentFreeSum = 0;
	let currentProSum = 0;

	let freeIncome = 0;
	let proIncome = 0;

	for (let level = 1; level <= 10; level++) {
		labels.push(`Ур. ${level}`);

		// Геометрическая прогрессия
		// Уровень 1 = direct. Уровень 2 = direct * viral и тд.
		const peopleAtLevel = direct * Math.pow(viral, level - 1);

		// FREE обрезается после 3-го уровня
		if (level <= 3) {
			currentFreeSum += peopleAtLevel;
			freeIncome += peopleAtLevel * avgProfitPerAgent;
		}

		// PRO идет до 10-го
		currentProSum += peopleAtLevel;
		proIncome += peopleAtLevel * avgProfitPerAgent;

		dataFree.push(currentFreeSum);
		dataPro.push(currentProSum);
	}

	document.getElementById("res-b3-free-income").textContent =
		"$" + freeIncome.toLocaleString("ru-RU");
	document.getElementById("res-b3-pro-income").textContent =
		"$" + proIncome.toLocaleString("ru-RU");

	drawChart(labels, dataFree, dataPro);
}

// --- ОТРИСОВКА ГРАФИКА (Chart.js) ---
function drawChart(labels, dataFree, dataPro) {
	const ctx = document.getElementById("networkChart").getContext("2d");

	if (networkChartInstance) {
		networkChartInstance.destroy();
	}

	// Градиент для PRO (чтобы выглядело сочно)
	let gradientPro = ctx.createLinearGradient(0, 0, 0, 400);
	gradientPro.addColorStop(0, "rgba(6, 182, 212, 0.5)"); // Cyan
	gradientPro.addColorStop(1, "rgba(168, 85, 247, 0.1)"); // Purple

	networkChartInstance = new Chart(ctx, {
		type: "line",
		data: {
			labels: labels,
			datasets: [
				{
					label: "FREE (Обрезка на 3 ур.)",
					data: dataFree,
					borderColor: "#9ca3af", // Серый
					backgroundColor: "rgba(156, 163, 175, 0.1)",
					borderWidth: 2,
					fill: true,
					tension: 0.4,
					stepped: true, // Чтобы было видно жесткую обрезку
				},
				{
					label: "PRO / ROCKET (Упущенная прибыль)",
					data: dataPro,
					borderColor: "#06b6d4", // Cyan
					backgroundColor: gradientPro,
					borderWidth: 3,
					fill: true,
					tension: 0.4,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			interaction: { mode: "index", intersect: false },
			plugins: {
				legend: {
					labels: { color: "#d1d5db", font: { size: 12, weight: "bold" } },
				},
				tooltip: {
					callbacks: {
						label: function (context) {
							let label = context.dataset.label || "";
							if (label) label += ": ";
							if (context.parsed.y !== null) {
								label += context.parsed.y.toLocaleString("ru-RU") + " агентов";
							}
							return label;
						},
					},
				},
			},
			scales: {
				y: {
					beginAtZero: true,
					grid: { color: "rgba(255, 255, 255, 0.05)" },
					ticks: {
						color: "#9ca3af",
						callback: function (val) {
							return val >= 1000 ? val / 1000 + "k" : val;
						},
					},
				},
				x: {
					grid: { display: false },
					ticks: { color: "#9ca3af" },
				},
			},
		},
	});
}

// --- ВСПОМОГАТЕЛЬНАЯ АНИМАЦИЯ ЧИСЕЛ ---
function animateValue(id, end, decimals) {
	const obj = document.getElementById(id);
	if (!obj) return;

	// Простая моментальная вставка для производительности (анимация тут может грузить слабые телефоны)
	// Если хочешь анимацию, можно вернуть requestAnimationFrame, но для денег лучше четкость.
	if (decimals === 0) {
		obj.textContent = Math.round(end).toLocaleString("ru-RU");
	} else {
		obj.textContent = end.toLocaleString("ru-RU", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
	}
}
