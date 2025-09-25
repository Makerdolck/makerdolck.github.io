const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

let width, height;
let shape = 'circle';
let color = '#ff0000';
let time = 0;

function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}

function randomColor() {
    return `hsl(${Math.random() * 360}, 100%, 50%)`;
}

function randomShape() {
    return Math.random() < 0.5 ? 'circle' : 'square';
}

function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;

    if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 50 + Math.sin(time) * 30, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillRect(width / 2 - 50, height / 2 - 50, 100 + Math.sin(time) * 60, 100 + Math.sin(time) * 60);
    }
}

function animate() {
    time += 0.05;
    color = randomColor();
    shape = randomShape();
    draw();
    requestAnimationFrame(animate);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
animate();