/**
 * SetHubble - Particles Effect
 * Эффект частиц, разбегающихся от мыши.
 * Работает только на экранах шире 992px.
 */

document.addEventListener("DOMContentLoaded", function () {
    // Проверка на ширину экрана (только ПК)
    if (window.innerWidth < 992) return;

    const canvas = document.getElementById("hero-particles");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let particlesArray;

    // Настраиваем размер канваса
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Объект мыши
    let mouse = {
        x: null,
        y: null,
        radius: 100 // Радиус взаимодействия
    }

    window.addEventListener('mousemove', function(event) {
        // Корректируем координаты относительно канваса, а не всего окна
        const rect = canvas.getBoundingClientRect();
        mouse.x = event.clientX - rect.left;
        mouse.y = event.clientY - rect.top;
    });

    // Убираем взаимодействие, если мышь ушла с хедера
    window.addEventListener('mouseout', function() {
        mouse.x = undefined;
        mouse.y = undefined;
    });

    // Класс частицы
    class Particle {
        constructor(x, y, directionX, directionY, size, color) {
            this.x = x;
            this.y = y;
            this.directionX = directionX;
            this.directionY = directionY;
            this.size = size;
            this.color = color;
            this.baseX = x; // Запоминаем начальную позицию (опционально)
            this.baseY = y;
            this.density = (Math.random() * 30) + 1; // Вес частицы
        }

        // Рисуем частицу
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false);
            ctx.fillStyle = this.color;
            ctx.fill();
        }

        // Обновляем позицию
        update() {
            // Проверка столкновения с мышью
            let dx = mouse.x - this.x;
            let dy = mouse.y - this.y;
            let distance = Math.sqrt(dx*dx + dy*dy);
            let forceDirectionX = dx / distance;
            let forceDirectionY = dy / distance;
            let maxDistance = mouse.radius;
            let force = (maxDistance - distance) / maxDistance;
            let directionX = forceDirectionX * force * this.density;
            let directionY = forceDirectionY * force * this.density;

            if (distance < mouse.radius) {
                // Если мышь близко - убегаем
                this.x -= directionX;
                this.y -= directionY;
            } else {
                // Если мышь далеко - возвращаемся к обычному движению
                // или просто плывем
                if (this.x !== this.baseX) {
                    let dx = this.x - this.baseX;
                    this.x -= dx/10; // Плавный возврат
                }
                if (this.y !== this.baseY) {
                    let dy = this.y - this.baseY;
                    this.y -= dy/10;
                }
            }
            
            // Легкое хаотичное движение, чтобы не было скучно
            this.x += this.directionX;
            this.y += this.directionY;

            // Отталкивание от краев (опционально, чтобы не улетали совсем)
            if (this.x < 0 || this.x > canvas.width) this.directionX = -this.directionX;
            if (this.y < 0 || this.y > canvas.height) this.directionY = -this.directionY;

            this.draw();
        }
    }

    function init() {
        particlesArray = [];
        // Количество частиц зависит от размера экрана
        let numberOfParticles = (canvas.height * canvas.width) / 9000;
        
        // Цвета из вашей темы
        const colors = [
            'rgba(99, 102, 241, 0.5)', // Primary
            'rgba(236, 72, 153, 0.5)', // Accent
            'rgba(0, 247, 255, 0.5)',  // Neon
            'rgba(255, 255, 255, 0.3)' // White transparent
        ];

        for (let i = 0; i < numberOfParticles; i++) {
            let size = (Math.random() * 3) + 1;
            let x = (Math.random() * ((innerWidth - size * 2) - (size * 2)) + size * 2);
            let y = (Math.random() * ((innerHeight - size * 2) - (size * 2)) + size * 2);
            let directionX = (Math.random() * 1) - 0.5; // Скорость по X
            let directionY = (Math.random() * 1) - 0.5; // Скорость по Y
            let color = colors[Math.floor(Math.random() * colors.length)];

            particlesArray.push(new Particle(x, y, directionX, directionY, size, color));
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        ctx.clearRect(0, 0, innerWidth, innerHeight);

        for (let i = 0; i < particlesArray.length; i++) {
            particlesArray[i].update();
        }
    }

    // Ресайз окна
    window.addEventListener('resize', function() {
        if (window.innerWidth < 992) {
            canvas.width = 0; // Скрываем/очищаем на мобильных
        } else {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            init();
        }
    });

    init();
    animate();
});
