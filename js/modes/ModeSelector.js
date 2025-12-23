/**
 * Mode Selector - UI for selecting game mode before creating a room
 * Allows host to choose between "Pelea de Peluches" (Smash) and "Arena de Peluches" (Arena)
 */

export const GAME_MODES = {
    SMASH: 'smash',
    ARENA: 'arena'
};

export const MODE_CONFIG = {
    [GAME_MODES.SMASH]: {
        id: 'smash',
        name: 'Pelea de Peluches',
        description: 'Estilo Smash Bros - Plataformas, caídas y KOs',
        icon: '🥊',
        features: [
            'Plataformas flotantes',
            'Caída = KO',
            'Sistema de stocks',
            'Vista lateral'
        ],
        color: '#ff3366'
    },
    [GAME_MODES.ARENA]: {
        id: 'arena',
        name: 'Arena de Peluches',
        description: 'Estilo Royal Rumble - Ring de lucha, vida y estamina',
        icon: '🏟️',
        features: [
            'Ring de lucha 3D',
            'Barra de vida',
            'Sistema de estamina',
            'Agarres y lanzamientos'
        ],
        color: '#00ffcc'
    }
};

class ModeSelector {
    constructor(onModeSelected) {
        this.selectedMode = null;
        this.onModeSelected = onModeSelected;
        this.overlay = null;
    }

    /**
     * Show the mode selection screen
     */
    show() {
        // Create overlay if it doesn't exist
        if (!this.overlay) {
            this.createOverlay();
        }
        
        this.overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hide the mode selection screen
     */
    hide() {
        if (this.overlay) {
            this.overlay.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    /**
     * Create the mode selection overlay UI
     */
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'mode-selector-overlay';
        this.overlay.className = 'mode-selector-overlay';

        this.overlay.innerHTML = `
            <div class="mode-selector-container">
                <h1 class="mode-selector-title">SELECCIONA EL MODO</h1>
                <div class="mode-cards">
                    ${Object.values(MODE_CONFIG).map(mode => `
                        <div class="mode-card" data-mode="${mode.id}" style="--mode-color: ${mode.color}">
                            <div class="mode-icon">${mode.icon}</div>
                            <h2 class="mode-name">${mode.name}</h2>
                            <p class="mode-description">${mode.description}</p>
                            <ul class="mode-features">
                                ${mode.features.map(f => `<li>${f}</li>`).join('')}
                            </ul>
                            <button class="mode-select-btn" data-mode="${mode.id}">
                                SELECCIONAR
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Add styles
        this.addStyles();

        // Add event listeners
        this.overlay.querySelectorAll('.mode-card').forEach(card => {
            card.addEventListener('click', () => {
                this.selectMode(card.dataset.mode);
            });
        });

        this.overlay.querySelectorAll('.mode-select-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectMode(btn.dataset.mode);
            });
        });

        document.body.appendChild(this.overlay);
    }

    /**
     * Add CSS styles for the mode selector
     */
    addStyles() {
        if (document.getElementById('mode-selector-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'mode-selector-styles';
        styles.textContent = `
            .mode-selector-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: linear-gradient(135deg, #0a0a15 0%, #1a1a2e 50%, #0a0a15 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                opacity: 1;
                transition: opacity 0.5s ease;
            }

            .mode-selector-overlay.hidden {
                opacity: 0;
                pointer-events: none;
            }

            .mode-selector-container {
                text-align: center;
                padding: 40px;
                max-width: 1200px;
                width: 100%;
            }

            .mode-selector-title {
                font-family: 'Orbitron', sans-serif;
                font-size: 3rem;
                font-weight: 900;
                background: linear-gradient(135deg, #ff3366, #ffcc00, #00ffcc);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 50px;
                letter-spacing: 6px;
                text-shadow: none;
                filter: drop-shadow(0 0 20px rgba(255, 204, 0, 0.3));
            }

            .mode-cards {
                display: flex;
                justify-content: center;
                gap: 40px;
                flex-wrap: wrap;
            }

            .mode-card {
                background: rgba(20, 20, 40, 0.9);
                border: 3px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 40px;
                width: 380px;
                cursor: pointer;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }

            .mode-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: var(--mode-color);
                opacity: 0.5;
                transition: opacity 0.3s;
            }

            .mode-card:hover {
                border-color: var(--mode-color);
                transform: translateY(-10px);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px color-mix(in srgb, var(--mode-color) 30%, transparent);
            }

            .mode-card:hover::before {
                opacity: 1;
            }

            .mode-icon {
                font-size: 5rem;
                margin-bottom: 20px;
                filter: drop-shadow(0 0 20px var(--mode-color));
            }

            .mode-name {
                font-family: 'Orbitron', sans-serif;
                font-size: 1.5rem;
                font-weight: 700;
                color: white;
                margin-bottom: 15px;
                text-transform: uppercase;
                letter-spacing: 2px;
            }

            .mode-description {
                color: rgba(255, 255, 255, 0.7);
                font-size: 1rem;
                margin-bottom: 25px;
                line-height: 1.5;
            }

            .mode-features {
                list-style: none;
                padding: 0;
                margin: 0 0 30px 0;
                text-align: left;
            }

            .mode-features li {
                color: rgba(255, 255, 255, 0.6);
                font-size: 0.9rem;
                padding: 8px 0;
                padding-left: 25px;
                position: relative;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }

            .mode-features li::before {
                content: '✓';
                position: absolute;
                left: 0;
                color: var(--mode-color);
                font-weight: bold;
            }

            .mode-select-btn {
                width: 100%;
                padding: 16px 32px;
                font-family: 'Orbitron', sans-serif;
                font-size: 1rem;
                font-weight: 700;
                background: linear-gradient(135deg, var(--mode-color), color-mix(in srgb, var(--mode-color) 70%, white));
                border: none;
                border-radius: 12px;
                color: #0a0a15;
                cursor: pointer;
                transition: all 0.3s;
                text-transform: uppercase;
                letter-spacing: 2px;
            }

            .mode-select-btn:hover {
                transform: scale(1.05);
                box-shadow: 0 0 30px var(--mode-color);
            }

            @media (max-width: 900px) {
                .mode-cards {
                    flex-direction: column;
                    align-items: center;
                }
                
                .mode-card {
                    width: 100%;
                    max-width: 400px;
                }
                
                .mode-selector-title {
                    font-size: 2rem;
                }
            }
        `;

        document.head.appendChild(styles);
    }

    /**
     * Handle mode selection
     * @param {string} modeId - Selected mode ID
     */
    selectMode(modeId) {
        this.selectedMode = modeId;
        
        // Visual feedback
        this.overlay.querySelectorAll('.mode-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.mode === modeId);
        });

        // Callback with selected mode
        if (this.onModeSelected) {
            this.onModeSelected(modeId);
        }

        // Hide selector after a brief delay for visual feedback
        setTimeout(() => {
            this.hide();
        }, 300);
    }

    /**
     * Get the currently selected mode
     * @returns {string|null} Selected mode ID
     */
    getSelectedMode() {
        return this.selectedMode;
    }

    /**
     * Dispose of the selector
     */
    dispose() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

export default ModeSelector;

