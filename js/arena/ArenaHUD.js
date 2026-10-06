/**
 * Arena HUD - Health and Stamina bars for Arena mode
 * Displays player health, stamina, and status indicators
 */

// Player-provided text must be escaped before going through innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// Only allow plain CSS colors (hex / named) inside the inline style
function safeColor(value) {
    const color = String(value ?? '');
    return /^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]+$/i.test(color) ? color : '#ffffff';
}

class ArenaHUD {
    constructor() {
        this.container = document.getElementById('arena-player-huds');
        this.playerHUDs = new Map();
        this.refCountTimer = null; // Auto-hide of the referee pin count overlay
        this.feedTimers = new Set(); // Elimination feed fade-outs (cleared on reset)
        this.battleUI = null;        // Battle royal panel (feed + "QUEDAN N"), see getBattlePanel
        
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
        const color = safeColor(player.color);

        hud.innerHTML = `
            <div class="arena-hud-header">
                <div class="arena-player-badge" style="background: ${color}; box-shadow: 0 0 15px ${color};">
                    P${escapeHtml(player.number)}
                </div>
                <span class="arena-player-name">${escapeHtml(player.name)}</span>
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

            <div class="arena-spirit-container">
                <div class="arena-spirit-label">
                    <span class="spirit-title">🔥 ÁNIMO</span>
                    <span class="spirit-value">0%</span>
                </div>
                <div class="arena-spirit-bar">
                    <div class="arena-spirit-fill" style="width: 0%"></div>
                </div>
            </div>
        `;
        
        this.container.appendChild(hud);
        this.playerHUDs.set(player.id, {
            element: hud,
            player: player
        });
        this.updateLayout();
        
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
            this.updateLayout();
        }
    }

    /**
     * Compact cards from 5 players up, so 8 cards stay on screen and readable
     * (they also leave room for the battle royal panel on the right, see arena.css)
     */
    updateLayout() {
        this.container?.classList.toggle('compact', this.playerHUDs.size >= 5);
    }
    
    /**
     * Hide a player's HUD with fade out effect (for elimination)
     * @param {string} playerId - Player ID
     */
    hidePlayer(playerId) {
        const hudData = this.playerHUDs.get(playerId);
        
        if (hudData) {
            const hud = hudData.element;
            
            // Add eliminated class for styling
            hud.classList.add('eliminated', 'fading-out');
            
            // Animate fade out
            hud.style.transition = 'opacity 1s ease-out, transform 1s ease-out';
            hud.style.opacity = '0.3';
            hud.style.transform = 'scale(0.9)';
            
            // Add "ELIMINADO" overlay
            const eliminatedOverlay = document.createElement('div');
            eliminatedOverlay.className = 'eliminated-overlay';
            eliminatedOverlay.innerHTML = '❌ ELIMINADO';
            eliminatedOverlay.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 1rem;
                font-weight: bold;
                color: #ff3366;
                text-shadow: 0 0 10px #ff0000;
                white-space: nowrap;
            `;
            hud.style.position = 'relative';
            hud.appendChild(eliminatedOverlay);
        }
    }
    
    /**
     * Undo hidePlayer()/showElimination() for a new round or rematch
     * @param {string} playerId - Player ID
     */
    resetPlayer(playerId) {
        const hudData = this.playerHUDs.get(playerId);
        if (!hudData) return;

        const hud = hudData.element;
        hud.classList.remove('eliminated', 'fading-out');
        hud.style.transition = '';
        hud.style.opacity = '';
        hud.style.transform = '';
        hud.style.animation = '';
        hud.querySelectorAll('.eliminated-overlay, .arena-eliminated-overlay, .arena-status-indicator, .arena-damage-number')
            .forEach(el => el.remove());

        this.updatePlayer(hudData.player);
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

        this.updateSpirit(hudData, controller);
        
        // Update eliminated state
        hud.classList.toggle('eliminated', controller.isEliminated);
        
        // Update player name (in case it changed)
        const nameEl = hud.querySelector('.arena-player-name');
        if (nameEl && player.name) {
            nameEl.textContent = player.name;
        }
    }
    
    /**
     * Spirit meter: fills up to 100; when SPECIAL it glows/pulses with "¡ESPECIAL!" and drains
     * with the time left to use the finisher (countdown in seconds)
     * @param {object} hudData - Entry of playerHUDs
     * @param {object} controller - ArenaPlayerController
     */
    updateSpirit(hudData, controller) {
        if (!hudData.spirit) {
            const hud = hudData.element;
            hudData.spirit = {
                container: hud.querySelector('.arena-spirit-container'),
                fill: hud.querySelector('.arena-spirit-fill'),
                title: hud.querySelector('.spirit-title'),
                value: hud.querySelector('.spirit-value'),
                last: {}
            };
        }
        const ui = hudData.spirit;
        if (!ui.container || !ui.fill) return;

        const special = !!controller.isSpecial && !controller.isEliminated;
        const spirit = Math.max(0, Math.min(100, Math.round(controller.spirit || 0)));
        const duration = controller.specialDuration || 12000;
        const msLeft = Math.max(0, controller.specialMsLeft || 0);
        const width = special ? Math.max(0, Math.min(100, (msLeft / duration) * 100)) : spirit;
        const title = special ? '¡ESPECIAL!' : '🔥 ÁNIMO';
        const value = special ? `${Math.ceil(msLeft / 1000)}s` : `${spirit}%`;

        // Only touch the DOM when something changed (called every frame)
        const last = ui.last;
        if (last.special !== special) {
            ui.container.classList.toggle('special', special);
            last.special = special;
        }
        if (last.width !== width) {
            ui.fill.style.width = `${width}%`;
            last.width = width;
        }
        if (last.title !== title) {
            ui.title.textContent = title;
            last.title = title;
        }
        if (last.value !== value) {
            ui.value.textContent = value;
            last.value = value;
        }
        const full = !special && spirit >= 100;
        if (last.full !== full) {
            ui.container.classList.toggle('full', full);
            last.full = full;
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
     * Big referee overlay for pins: "1", "2", "3!", "¡SE ZAFÓ!", "¡CUENTA DE 3!"
     * @param {string} text - Text to show
     * @param {string} variant - 'start' | 'count' | 'final' | 'kickout' | 'pinfall'
     * @param {number} holdMs - Time before it hides again
     */
    showRefCount(text, variant = 'count', holdMs = 900) {
        let el = document.getElementById('arena-ref-count');
        if (!el) {
            el = document.createElement('div');
            el.id = 'arena-ref-count';
            (document.getElementById('game-container') || document.body).appendChild(el);
        }

        el.textContent = text;
        // Restart the pop animation
        el.className = '';
        void el.offsetWidth;
        el.className = `ref-${variant}`;

        clearTimeout(this.refCountTimer);
        this.refCountTimer = setTimeout(() => el.classList.add('hidden'), holdMs);
    }

    /**
     * Hide the referee overlay right away
     */
    hideRefCount() {
        clearTimeout(this.refCountTimer);
        document.getElementById('arena-ref-count')?.classList.add('hidden');
    }

    // =================================
    // Battle royal: elimination feed, remaining counter, banners
    // =================================

    /**
     * Top-right panel (from arena.html, created if missing)
     */
    getBattlePanel() {
        if (this.battleUI && this.battleUI.panel.isConnected) return this.battleUI;

        let panel = document.getElementById('arena-br-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'arena-br-panel';
            (document.getElementById('hud') || document.body).appendChild(panel);
        }
        let remaining = panel.querySelector('#arena-remaining');
        if (!remaining) {
            remaining = document.createElement('div');
            remaining.id = 'arena-remaining';
            remaining.className = 'hidden';
            remaining.innerHTML = '<span class="arena-remaining-label">QUEDAN</span><span class="arena-remaining-count">0</span>';
            panel.prepend(remaining);
        }
        let feed = panel.querySelector('#arena-elim-feed');
        if (!feed) {
            feed = document.createElement('div');
            feed.id = 'arena-elim-feed';
            panel.appendChild(feed);
        }
        this.battleUI = {
            panel,
            remaining,
            count: remaining.querySelector('.arena-remaining-count'),
            feed
        };
        return this.battleUI;
    }

    /**
     * "QUEDAN N" counter (null/0 hides it)
     * @param {number|null} count - Players still alive
     */
    setRemaining(count) {
        const ui = this.getBattlePanel();
        if (!Number.isFinite(count) || count < 1) {
            ui.remaining.classList.add('hidden');
            return;
        }
        const text = String(count);
        const changed = ui.count.textContent !== text || ui.remaining.classList.contains('hidden');
        ui.count.textContent = text;
        ui.remaining.classList.remove('hidden');
        ui.remaining.classList.toggle('final', count <= 2);
        if (changed) {
            // Restart the pop
            ui.remaining.classList.remove('bump');
            void ui.remaining.offsetWidth;
            ui.remaining.classList.add('bump');
        }
    }

    /**
     * Elimination feed entry: "<attacker> eliminó a <victim> · RING-OUT" or
     * "<victim> quedó fuera · ABANDONO". Newest on top, last 5 kept, each fades out.
     * @param {object} entry
     * @param {{name: string, color?: string}|null} entry.attacker
     * @param {{name: string, color?: string}} entry.victim
     * @param {string} entry.reason - 'RING-OUT' | 'KO' | 'CUENTA DE 3' | 'ABANDONO'
     */
    addEliminationFeed({ attacker = null, victim, reason }) {
        const ui = this.getBattlePanel();
        const row = document.createElement('div');
        row.className = 'arena-feed-entry';

        const nameEl = (p) => {
            const el = document.createElement('span');
            el.className = 'arena-feed-name';
            el.textContent = p?.name || '???';
            el.style.color = safeColor(p?.color);
            return el;
        };
        const textEl = (text, className = 'arena-feed-text') => {
            const el = document.createElement('span');
            el.className = className;
            el.textContent = text;
            return el;
        };

        if (attacker) {
            row.append(nameEl(attacker), textEl(' eliminó a '), nameEl(victim));
        } else {
            row.append(nameEl(victim), textEl(' quedó fuera'));
        }
        row.append(textEl(' · ', 'arena-feed-sep'), textEl(reason || 'KO', 'arena-feed-reason'));

        ui.feed.prepend(row);
        while (ui.feed.children.length > 5) ui.feed.lastElementChild.remove();

        const fade = setTimeout(() => {
            this.feedTimers.delete(fade);
            row.classList.add('fading');
        }, 7000);
        const drop = setTimeout(() => {
            this.feedTimers.delete(drop);
            row.remove();
        }, 7800);
        this.feedTimers.add(fade);
        this.feedTimers.add(drop);
    }

    /**
     * Big battle royal banner ("¡ÚLTIMOS DOS!")
     */
    showBattleBanner(text, ms = 2400) {
        const el = document.createElement('div');
        el.className = 'arena-br-banner';
        el.textContent = text;
        (document.getElementById('game-container') || document.body).appendChild(el);
        const timer = setTimeout(() => {
            this.feedTimers.delete(timer);
            el.remove();
        }, ms);
        this.feedTimers.add(timer);
    }

    /**
     * Empty the feed, hide the counter and banners (new match / round / rematch)
     */
    resetBattleRoyal() {
        this.feedTimers.forEach((timer) => clearTimeout(timer));
        this.feedTimers.clear();
        const ui = this.getBattlePanel();
        ui.feed.replaceChildren();
        ui.remaining.classList.add('hidden');
        ui.remaining.classList.remove('final', 'bump');
        document.querySelectorAll('.arena-br-banner').forEach((el) => el.remove());
    }

    /**
     * Clear all HUDs
     */
    clear() {
        this.playerHUDs.forEach((hudData, playerId) => {
            hudData.element.remove();
        });
        this.playerHUDs.clear();
        this.updateLayout();
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

