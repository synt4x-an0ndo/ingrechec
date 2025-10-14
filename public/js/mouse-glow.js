// Create and append the mouse glow element
function initializeMouseGlow() {
    const glow = document.createElement('div');
    glow.id = 'mouse-glow';
    document.body.appendChild(glow);

    // Add mouse move listener
    window.addEventListener('mousemove', (e) => {
        const x = e.clientX;
        const y = e.clientY;
        glow.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(22, 163, 74, 0.25), transparent 80%)`;
    });
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeMouseGlow);