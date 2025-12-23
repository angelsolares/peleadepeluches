/**
 * Arena HUD - Health and Stamina bars for Arena mode
 * Displays player health, stamina, and status indicators
 */

class ArenaHUD {
    constructor() {
        this.container = document.getElementById('arena-player-huds');
        this.playerHUDs = new Map();
        
        if (!this.container) {
            console.warn('[ArenaHUD] Container not found, creating one');
            this.createContainer();
        }
    }
    
    /**
     * Create the HUD container if it doesn't exist
     */
    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'arena-player-huds';
        document.getElementById('hud')?.appendChild(this.container);
    }
    
    /**
     * Add a player to the HUD
     * @param {object} player - Player entity
     */
    addPlayer(player) {
        if (this.playerHUDs.has(player.id)) {
            return; // Already exists
        }
        
        const hud = document.createElement('div');
        hud.className = 'arena-player-hud';
        hud.id = `arena-hud-${player.id}`;
        hud.dataset.playerId = player.id;
        
        const controller = player.controller;
        
        hud.innerHTML = `
            <div class="arena-hud-header">
                <div class="arena-player-badge" style="background: ${player.color}; box-shadow: 0 0 15px ${player.color};">
                    P${player.number}
                </div>
                <span class="arena-player-name">${player.name}</span>
            </div>
            
            <div class="arena-health-container">
                <div class="arena-health-label">
                    <span>❤️ VIDA</span>
                    <span class="health-value">${Math.floor(controller.health)}/${controller.maxHealth}</span>
                </div>
                <div class="arena-health-bar">
                    <div class="arena-health-fill" style="width: ${(controller.health / controller.maxHealth) * 100}%"></div>
                </div>
            </div>
            
            <div class="arena-stamina-container">
                <div class="arena-stamina-label">
                    <span>⚡ ESTAMINA</span>
                    <span class="stamina-value">${Math.floor(controller.stamina)}/${controller.maxStamina}</span>
                </div>
                <div class="arena-stamina-bar">
                    <div class="arena-stamina-fill" style="width: ${(controller.stamina / controller.maxStamina) * 100}%"></div>
                </div>
            </div>
        `;
        
        this.container.appendChild(hud);
        this.playerHUDs.set(player.id, {
            element: hud,
            player: player
        });
        
        // Initial update
        this.updatePlayer(player);
    }
    
    /**
     * Remove a player from the HUD
     * @param {string} playerId - Player ID
     */
    removePlayer(playerId) {
        const hudData = this.playerHUDs.get(playerId);
        
        if (hudData) {
            hudData.element.remove();
            this.playerHUDs.delete(playerId);
        }
    }
    
    /**
     * Update a player's HUD display
     * @param {object} player - Player entity
     */
    updatePlayer(player) {
        const hudData = this.playerHUDs.get(player.id);
        if (!hudData) return;
        
        const hud = hudData.element;
        const controller = player.controller;
        
        // Update health bar
        const healthPercent = (controller.health / controller.maxHealth) * 100;
        const healthFill = hud.querySelector('.arena-health-fill');
        const healthValue = hud.querySelector('.health-value');
        
        if (healthFill) {
            healthFill.style.width = `${healthPercent}%`;
            
            // Update health color class
            healthFill.classList.remove('medium', 'low', 'critical');
            if (healthPercent <= 20) {
                healthFill.classList.add('critical');
            } else if (healthPercent <= 40) {
                healthFill.classList.add('low');
            } else if (healthPercent <= 60) {
                healthFill.classList.add('medium');
            }
        }
        
        if (healthValue) {
            healthValue.textContent = `${Math.floor(controller.health)}/${controller.maxHealth}`;
        }
        
        // Update stamina bar
        const staminaPercent = (controller.stamina / controller.maxStamina) * 100;
        const staminaFill = hud.querySelector('.arena-stamina-fill');
        const staminaValue = hud.querySelector('.stamina-value');
        
        if (staminaFill) {
            staminaFill.style.width = `${staminaPercent}%`;
            
            // Update exhausted state
            staminaFill.classList.toggle('exhausted', controller.isExhausted);
        }
        
        if (staminaValue) {
            staminaValue.textContent = `${Math.floor(controller.stamina)}/${controller.maxStamina}`;
        }
        
        // Update eliminated state
        hud.classList.toggle('eliminated', controller.isEliminated);
        
        // Update player name (in case it changed)
        const nameEl = hud.querySelector('.arena-player-name');
        if (nameEl && player.name) {
            nameEl.textContent = player.name;
        }
    }
    
    /**
     * Show a status indicator above a player's HUD
     * @param {string} playerId - Player ID
     * @param {string} status - Status type ('stunned', 'grabbed', 'exhausted')
     */
    showStatus(playerId, status) {
        const hudData = this.playerHUDs.get(playerId);
        if (!hudData) return;
        
        const hud = hudData.element;
        
        // Remove any existing status indicator
        const existing = hud.querySelector('.arena-status-indicator');
        if (existing) existing.remove();
        
        // Create new status indicator
        const indicator = document.createElement('div');
        indicator.className = `arena-status-indicator ${status}`;
        
        switch (status) {
            case 'stunned':
                indicator.textContent = '💫 ATURDIDO';
                break;
            case 'grabbed':
                indicator.textContent = '🤼 AGARRADO';
                break;
            case 'exhausted':
                indicator.textContent = '😮‍💨 CANSADO';
                break;
            default:
                indicator.textContent = status.toUpperCase();
        }
        
        hud.appendChild(indicator);
        
        // Auto-remove after animation
        setTimeout(() => indicator.remove(), 1500);
    }
    
    /**
     * Show damage taken indicator
     * @param {string} playerId - Player ID
     * @param {number} damage - Damage amount
     * @param {boolean} blocked - Whether it was blocked
     */
    showDamage(playerId, damage, blocked = false) {
        const hudData = this.playerHUDs.get(playerId);
        if (!hudData) return;
        
        const hud = hudData.element;
        
        // Create damage number
        const damageEl = document.createElement('div');
        damageEl.className = 'arena-damage-number';
        damageEl.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-family: 'Orbitron', sans-serif;
            font-size: ${blocked ? '1rem' : '1.5rem'};
            font-weight: 900;
            color: ${blocked ? '#00bfff' : '#ff3366'};
            text-shadow: 0 0 10px currentColor;
            pointer-events: none;
            z-index: 10;
            animation: damage-pop 0.8s ease forwards;
        `;
        damageEl.textContent = blocked ? `🛡️ -${Math.floor(damage)}` : `-${Math.floor(damage)}`;
        
        hud.style.position = 'relative';
        hud.appendChild(damageEl);
        
        // Add animation keyframes if not exists
        if (!document.getElementById('arena-damage-animation')) {
            const style = document.createElement('style');
            style.id = 'arena-damage-animation';
            style.textContent = `
                @keyframes damage-pop {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.5);
                    }
                    20% {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1.2);
                    }
                    40% {
                        transform: translate(-50%, -60%) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -80%) scale(0.8);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Shake effect on HUD
        hud.style.animation = 'hit-shake 0.3s ease';
        setTimeout(() => {
            hud.style.animation = '';
        }, 300);
        
        // Remove damage element
        setTimeout(() => damageEl.remove(), 800);
    }
    
    /**
     * Show elimination effect
     * @param {string} playerId - Player ID
     */
    showElimination(playerId) {
        const hudData = this.playerHUDs.get(playerId);
        if (!hudData) return;
        
        const hud = hudData.element;
        
        // Add eliminated visual
        const eliminatedEl = document.createElement('div');
        eliminatedEl.className = 'arena-eliminated-overlay';
        eliminatedEl.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: 'Orbitron', sans-serif;
            font-size: 1.2rem;
            font-weight: 900;
            color: #ff3366;
            text-shadow: 0 0 20px #ff3366;
            border-radius: 16px;
            animation: fade-in 0.5s ease;
        `;
        eliminatedEl.textContent = '💀 ELIMINADO';
        
        hud.style.position = 'relative';
        hud.appendChild(eliminatedEl);
    }
    
    /**
     * Clear all HUDs
     */
    clear() {
        this.playerHUDs.forEach((hudData, playerId) => {
            hudData.element.remove();
        });
        this.playerHUDs.clear();
    }
    
    /**
     * Get player count
     * @returns {number} Number of players in HUD
     */
    getPlayerCount() {
        return this.playerHUDs.size;
    }
}

export default ArenaHUD;

