/**
 * SetHubble Landing Page - Calculator Script
 * Version: 8.1 (Fixed: Business Type Switcher Added)
 */
document.addEventListener("DOMContentLoaded", function () {
    const simulatorNode = document.getElementById('simulator');

    if (!simulatorNode) {
        return; 
    }

    if (typeof Chart === 'undefined') {
        console.error("Chart.js is not loaded. Cannot initialize simulator.");
        const chartError = simulatorNode.querySelector('#chart-error');
        if(chartError) chartError.style.display = 'block';
        return;
    }
    
    runCalculatorLogic(simulatorNode);
});

function runCalculatorLogic(simulatorNode) {
    const SIMULATION_MONTHS = 12;
    const MAX_COMMISSION_SUM = 80;
    
    const els = {
        price: simulatorNode.querySelector("#price"),
        initialPartners: simulatorNode.querySelector("#initialPartners"),
        partnerDuplication: simulatorNode.querySelector("#partnerDuplication"),
        priceValue: simulatorNode.querySelector("#priceValue"),
        initialPartnersValue: simulatorNode.querySelector("#initialPartnersValue"),
        partnerDuplicationValue: simulatorNode.querySelector("#partnerDuplicationValue"),
        
        // Колонки результатов
        classicColumn: simulatorNode.querySelector(".result-column.classic"),
        sethubbleColumn: simulatorNode.querySelector(".result-column.sethubble"),

        classic: {
            levels: simulatorNode.querySelector("#classicLevels"),
            levelsValue: simulatorNode.querySelector("#classicLevelsValue"),
            l1: simulatorNode.querySelector("#classicL1"),
            l2: simulatorNode.querySelector("#classicL2"),
            l1Row: simulatorNode.querySelector("#classicL1Row"),
            l2Row: simulatorNode.querySelector("#classicL2Row"),
            subtitle: simulatorNode.querySelector("#classicSubtitle"),
            partners: simulatorNode.querySelector("#classicTotalPartners"),
            income: simulatorNode.querySelector("#classicAuthorIncome"),
            incomeLabel: simulatorNode.querySelector("#classicIncomeLabel")
        },
        sethubble: {
            levels: simulatorNode.querySelector("#sethubbleLevels"),
            levelsValue: simulatorNode.querySelector("#sethubbleLevelsValue"),
            l1: simulatorNode.querySelector("#sethubbleL1"),
            l2plus: simulatorNode.querySelector("#sethubbleL2plus"),
            l1Row: simulatorNode.querySelector("#sethubbleL1Row"),
            l2plusRow: simulatorNode.querySelector("#sethubbleL2plusRow"),
            warning: simulatorNode.querySelector("#sethubbleWarning"),
            subtitle: simulatorNode.querySelector("#sethubbleSubtitle"),
            l2plusLabel: simulatorNode.querySelector("#sethubbleL2plusLabel"),
            partners: simulatorNode.querySelector("#sethubbleTotalPartners"),
            income: simulatorNode.querySelector("#sethubbleAuthorIncome"),
            incomeLabel: simulatorNode.querySelector("#sethubbleIncomeLabel")
        },
        conclusionText: simulatorNode.querySelector("#conclusionText"),
        chartCtx: simulatorNode.querySelector("#salesChart")?.getContext("2d"),
        
        // Переключатель Роли (Бизнес/Агент)
        modeSwitcher: simulatorNode.querySelector("#simulatorModeSwitcher"),
        modeButtons: simulatorNode.querySelectorAll("#simulatorModeSwitcher .mode-switch-btn"),
        simulatorSubtitle: simulatorNode.querySelector("#simulatorSubtitle"),
        priceLabel: simulatorNode.querySelector("#priceLabel"),
        initialPartnersLabel: simulatorNode.querySelector("#initialPartnersLabel"),
        duplicationLabel: simulatorNode.querySelector("#duplicationLabel"),

        // ✅ Переключатель Типа (Онлайн/Офлайн)
        typeSwitcher: simulatorNode.querySelector("#businessTypeSwitcher"),
        typeButtons: simulatorNode.querySelectorAll("#businessTypeSwitcher .mode-switch-btn"),
    };

    if (!els.price || !els.chartCtx) return;

    let salesChartInstance = null;
    let currentMode = "author";
    let currentType = "online"; // 'online' по умолчанию

    const config = {
        general: { price: 100, partners: 10, sales: 2 },
        classic: { levels: 2, commissions: [30, 5] },
        sethubble: { levels: 5, commissions: { l1: 40, l2plus: 5 } },
    };
    const formatNumber = (num) => Math.round(num).toLocaleString("ru-RU");

    function animateCounter(element, targetValue, isCurrency = false) {
        // Если тип бизнеса "Офлайн" и элемент относится к Классике - ставим 0
        if (currentType === 'offline' && element.closest('.classic')) {
             element.textContent = isCurrency ? "$0" : "0";
             return;
        }

        let startValue = parseFloat(element.textContent.replace(/[^0-9.-]+/g, "")) || 0;
        if(isNaN(startValue)) startValue = 0;
        const duration = 1000;
        let startTime = null;
        function animationStep(currentTime) {
            if (!startTime) startTime = currentTime;
            const progress = Math.min((currentTime - startTime) / duration, 1);
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const currentValue = startValue + (targetValue - startValue) * easeProgress;
            element.textContent = isCurrency ? "y.e. " + formatNumber(currentValue) : formatNumber(currentValue);
            if (progress < 1) requestAnimationFrame(animationStep);
            else element.textContent = isCurrency ? "y.e. " + formatNumber(targetValue) : formatNumber(targetValue);
        }
        requestAnimationFrame(animationStep);
    }

    function runSimulation(modelConfig, mode) {
        const { levels, commissions } = modelConfig;
        const { price, partners: monthlyRecruits, sales: duplicationRate } = config.general;
        let partnersByLevel = Array(levels).fill(0);
        let totalPayout = 0;
        let totalSalesCount = 0;
        let monthlyPartnersChart = [0];
        for (let month = 1; month <= SIMULATION_MONTHS; month++) {
            let newPartnersThisMonth = Array(levels).fill(0);
            if (levels > 0 && commissions.length > 0) {
                newPartnersThisMonth[0] = monthlyRecruits;
                totalSalesCount += monthlyRecruits;
                totalPayout += monthlyRecruits * price * (commissions[0] / 100);
            }
            for (let level = 0; level < levels - 1; level++) {
                const newRecruitsFromDepth = Math.round(partnersByLevel[level] * duplicationRate);
                newPartnersThisMonth[level + 1] += newRecruitsFromDepth;
                totalSalesCount += newRecruitsFromDepth;
                if (commissions[level + 1]) {
                    totalPayout += newRecruitsFromDepth * price * (commissions[level + 1] / 100);
                }
            }
            partnersByLevel = partnersByLevel.map((p, i) => p + newPartnersThisMonth[i]);
            monthlyPartnersChart.push(partnersByLevel.reduce((a, b) => a + b, 0));
        }
        const totalPartners = partnersByLevel.reduce((a, b) => a + b, 0);
        if (mode === "author") {
            const totalRevenue = totalSalesCount * price;
            const authorIncome = levels > 0 ? (totalRevenue - totalPayout) : (monthlyRecruits * SIMULATION_MONTHS * price);
            return { totalPartners, income: authorIncome, monthlyPartnersChart };
        } else {
            const partnerIncome = totalPayout;
            return { totalPartners, income: partnerIncome, monthlyPartnersChart };
        }
    }

    // --- ПЕРЕКЛЮЧЕНИЕ РОЛИ (Бизнес / Агент) ---
    window.setSimulatorMode = function (newMode) {
        if (newMode === currentMode) return;
        currentMode = newMode;
        els.modeSwitcher.dataset.mode = newMode;
        els.modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === newMode));

        if (newMode === "author") {
            els.simulatorSubtitle.innerText = "Рассчитайте чистую прибыль вашего бизнеса (за вычетом выплат агентам).";
            els.priceLabel.innerText = "Средний чек (USD)";
            els.initialPartnersLabel.innerText = "Продаж в месяц";
            els.duplicationLabel.innerText = "Мультипликация (приводит каждый агент)";
            els.classic.incomeLabel.innerText = "Ваша прибыль";
            els.sethubble.incomeLabel.innerText = "Ваша прибыль";
        } else {
            els.simulatorSubtitle.innerText = "Рассчитайте свой доход от подключения магазинов, сервисов и других агентов.";
            els.priceLabel.innerText = "Средний чек магазинов";
            els.initialPartnersLabel.innerText = "Личных подключений в месяц";
            els.duplicationLabel.innerText = "Рост сети (подключает каждый)";
            els.classic.incomeLabel.innerText = "Ваш доход";
            els.sethubble.incomeLabel.innerText = "Ваш доход";
        }
        window.renderSimulator();
    };

    // --- ✅ ДОБАВЛЕНО: ПЕРЕКЛЮЧЕНИЕ ТИПА БИЗНЕСА (Онлайн / Офлайн) ---
    window.setBusinessType = function (newType) {
        if (newType === currentType) return;
        currentType = newType;
        
        // Меняем активную кнопку
        els.typeSwitcher.dataset.type = newType;
        els.typeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.type === newType));

        // Отключаем/Включаем колонку "Классика"
        if (newType === 'offline') {
            els.classicColumn.classList.add('is-disabled');
        } else {
            els.classicColumn.classList.remove('is-disabled');
        }

        window.renderSimulator();
    };

    function updateSimulatorUI() {
        els.priceValue.textContent = "y.e. " + config.general.price;
        els.initialPartnersValue.textContent = config.general.partners;
        els.partnerDuplicationValue.textContent = config.general.sales;
        els.classic.levelsValue.textContent = config.classic.levels;
        els.classic.l1Row.classList.toggle("hidden", config.classic.levels < 1);
        els.classic.l2Row.classList.toggle("hidden", config.classic.levels < 2);
        let classicSubtitle = "Нет партнерки";
        if (config.classic.levels > 0) {
            classicSubtitle = `${config.classic.levels} ур.: ${[config.classic.commissions[0], config.classic.commissions[1]].slice(0, config.classic.levels).join("% + ")}%`;
        }
        els.classic.subtitle.textContent = classicSubtitle;
        els.sethubble.levelsValue.textContent = config.sethubble.levels;
        els.sethubble.l1Row.classList.toggle("hidden", config.sethubble.levels < 1);
        els.sethubble.l2plusRow.classList.toggle("hidden", config.sethubble.levels < 2);
        if (config.sethubble.levels > 1) {
            els.sethubble.l2plusLabel.textContent = `Комиссия ур. 2-${config.sethubble.levels}, %`;
        }
        let sethubbleSubtitle = "Нет партнерки";
        if (config.sethubble.levels > 0) {
            let commsStr = `${config.sethubble.commissions.l1}%`;
            if (config.sethubble.levels > 1)
                commsStr += ` + ${config.sethubble.levels - 1}x${config.sethubble.commissions.l2plus}%`;
            sethubbleSubtitle = `${config.sethubble.levels} уровней: ${commsStr}`;
        }
        els.sethubble.subtitle.textContent = sethubbleSubtitle;
    }

    function validateSetHubbleCommissions(changedInputId) {
        const { levels } = config.sethubble;
        if (levels < 1) {
            els.sethubble.warning.textContent = "";
            return;
        }
        let l1 = parseInt(els.sethubble.l1.value) || 0;
        let l2plus = parseInt(els.sethubble.l2plus.value) || 0;
        const currentTotal = levels > 1 ? l1 + (levels - 1) * l2plus : l1;
        if (currentTotal > MAX_COMMISSION_SUM) {
            if (changedInputId === "sethubbleL1" && levels > 1) {
                l2plus = Math.max(0, Math.floor((MAX_COMMISSION_SUM - l1) / (levels - 1)));
                els.sethubble.l2plus.value = l2plus;
            } else {
                l1 = Math.max(0, MAX_COMMISSION_SUM - (levels - 1) * l2plus);
                els.sethubble.l1.value = l1;
            }
            els.sethubble.warning.textContent = `⚠️ Сумма ограничена ${MAX_COMMISSION_SUM}%, чтобы оставалась прибыль.`;
            config.sethubble.commissions.l1 = l1;
            config.sethubble.commissions.l2plus = l2plus;
        } else {
            els.sethubble.warning.textContent = "";
        }
    }
    
    // --- ОТРИСОВКА ---
    window.renderSimulator = function () {
        if (typeof Chart === 'undefined' || !els.chartCtx) return;

        const classicCommsArray = [parseInt(els.classic.l1.value) || 0, parseInt(els.classic.l2.value) || 0];
        const classicSimConfig = { levels: config.classic.levels, commissions: classicCommsArray };
        const sethubbleCommsArray = Array(config.sethubble.levels).fill(0).map((_, i) => (i === 0 ? config.sethubble.commissions.l1 : config.sethubble.commissions.l2plus));
        const sethubbleSimConfig = { levels: config.sethubble.levels, commissions: sethubbleCommsArray };
        
        const classicResults = runSimulation(classicSimConfig, currentMode);
        const sethubbleResults = runSimulation(sethubbleSimConfig, currentMode);
        
        animateCounter(els.classic.partners, classicResults.totalPartners);
        animateCounter(els.classic.income, classicResults.income, true);
        animateCounter(els.sethubble.partners, sethubbleResults.totalPartners);
        animateCounter(els.sethubble.income, sethubbleResults.income, true);

        // --- ЛОГИКА ТЕКСТА ВЫВОДА ---
        let incomeFactor;
        
        if (currentType === 'offline') {
            // Если Офлайн, сравнивать не с чем
            incomeFactor = `<span class="highlight">Уникальное решение</span> для масштабирования офлайн-бизнеса`;
            els.conclusionText.innerHTML = incomeFactor;
        } else {
            // Логика для Онлайна
            if (classicResults.income > 0) {
                const factor = sethubbleResults.income / classicResults.income;
                if (factor > 1.1) {
                    incomeFactor = `<span class="highlight">в ${factor.toFixed(1)} раз(а)</span> больше`;
                } else if (factor < 0.9 && factor > 0) {
                    incomeFactor = `в ${(1 / factor).toFixed(1)} раз(а) меньше`;
                } else {
                    incomeFactor = "почти столько же";
                }
            } else if (sethubbleResults.income > 0) {
                incomeFactor = "неизмеримо больше";
            } else {
                incomeFactor = "такой же (нулевой)";
            }
            const incomeType = currentMode === "author" ? "чистого дохода" : "комиссионного дохода";
            els.conclusionText.innerHTML = `Модель SetHubble принесет вам ${incomeFactor} <b>${incomeType}</b> за год.`;
        }
        
        if (salesChartInstance) salesChartInstance.destroy();
        
        const labels = Array.from({ length: SIMULATION_MONTHS + 1 }, (_, i) => i === 0 ? "Старт" : `${i} мес`);
        const chartLabel = currentMode === "author" ? "Партнеры в сети" : "Партнеры в команде";
        const styles = getComputedStyle(simulatorNode);
        const grayColor = styles.getPropertyValue("--text-gray").trim();
        const legendColor = styles.getPropertyValue("--text-light").trim();
        const gridColor = styles.getPropertyValue("--glass-border").trim();

        // Формируем данные для графика
        let datasets = [];
        // Добавляем классику ТОЛЬКО если это онлайн
        if (currentType === 'online') {
            datasets.push({ 
                label: `${chartLabel} (Classic)`, 
                data: classicResults.monthlyPartnersChart, 
                borderColor: '#ec4899', 
                borderWidth: 2, 
                backgroundColor: "rgba(236, 72, 153, 0.1)", 
                fill: true, 
                tension: 0.4 
            });
        }
        // SetHubble добавляем всегда
        datasets.push({ 
            label: `${chartLabel} (SetHubble)`, 
            data: sethubbleResults.monthlyPartnersChart, 
            borderColor: '#00f7ff', 
            borderWidth: 3, 
            backgroundColor: "rgba(0, 247, 255, 0.2)", 
            fill: true, 
            tension: 0.4 
        });

        salesChartInstance = new Chart(els.chartCtx, {
            type: "line",
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: { legend: { position: "top", labels: { color: legendColor, font: { family: "Inter" } } } },
                scales: { y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: grayColor } }, x: { grid: { display: false }, ticks: { color: grayColor } } },
            },
        });
    };

    function handleInputChange(e) {
        const { id, value } = e.target;
        const val = parseFloat(value) || 0;
        switch (id) {
            case "price": config.general.price = val; break;
            case "initialPartners": config.general.partners = parseInt(val); break;
            case "partnerDuplication": config.general.sales = val; break;
            case "classicLevels": config.classic.levels = parseInt(val); break;
            case "sethubbleLevels": config.sethubble.levels = parseInt(val); validateSetHubbleCommissions(id); break;
            case "classicL1": config.classic.commissions[0] = val; break;
            case "classicL2": config.classic.commissions[1] = val; break;
            case "sethubbleL1": config.sethubble.commissions.l1 = val; validateSetHubbleCommissions(id); break;
            case "sethubbleL2plus": config.sethubble.commissions.l2plus = val; validateSetHubbleCommissions(id); break;
        }
        updateSimulatorUI();
        window.renderSimulator();
    }
    
    // Подключаем слушатели событий
    simulatorNode.querySelectorAll("input").forEach((input) => {
        const eventType = input.type === "range" ? "input" : "change";
        input.addEventListener(eventType, handleInputChange);
    });
    
    // Переключатель Роли
    els.modeSwitcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".mode-switch-btn");
        if (btn) window.setSimulatorMode(btn.dataset.mode);
    });

    // ✅ Переключатель Типа (Онлайн/Офлайн)
    if (els.typeSwitcher) {
        els.typeSwitcher.addEventListener("click", (e) => {
            const btn = e.target.closest(".mode-switch-btn");
            if (btn) window.setBusinessType(btn.dataset.type);
        });
    }
    
    els.price.value = config.general.price;
    els.initialPartners.value = config.general.partners;
    els.partnerDuplication.value = config.general.sales;
    els.classic.levels.value = config.classic.levels;
    els.classic.l1.value = config.classic.commissions[0];
    els.classic.l2.value = config.classic.commissions[1];
    els.sethubble.levels.value = config.sethubble.levels;
    els.sethubble.l1.value = config.sethubble.commissions.l1;
    els.sethubble.l2plus.value = config.sethubble.commissions.l2plus;
    
    updateSimulatorUI();
    window.renderSimulator();
}
