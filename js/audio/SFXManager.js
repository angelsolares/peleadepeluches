/**
 * SFXManager - Centralized Sound Effects System
 * Manages all audio playback for the game
 */
class SFXManager {
    constructor() {
        this.sounds = {};
        this.enabled = true;
        this.masterVolume = 0.7;
        
        // Sound categories with multiple variations for variety
        this.soundConfig = {
            // Punch sounds
            punchWhoosh: {
                files: ['sfx/punch_short_whoosh_16.wav', 'sfx/punch_short_whoosh_30.wav'],
                volume: 0.5
            },
            punchHit: {
                files: ['sfx/body_hit_small_11.wav', 'sfx/body_hit_small_20.wav', 'sfx/face_hit_small_01.wav'],
                volume: 0.6
            },
            
            // Kick sounds
            kickWhoosh: {
                files: ['sfx/kick_short_whoosh_12.wav', 'sfx/kick_short_whoosh_23.wav'],
                volume: 0.5
            },
            kickHit: {
                files: ['sfx/body_hit_large_32.wav', 'sfx/body_hit_large_44.wav', 'sfx/face_hit_Large_20.wav'],
                volume: 0.6
            },
            
            // Block sounds
            block: {
                files: ['sfx/block_medium_09.wav', 'sfx/block_medium_25.wav', 'sfx/block_large_59.wav'],
                volume: 0.7
            },
            
            // Hit reactions (when getting hit)
            hitSmall: {
                files: ['sfx/body_hit_small_23.wav', 'sfx/body_hit_small_79.wav'],
                volume: 0.5
            },
            hitLarge: {
                files: ['sfx/body_hit_large_76.wav', 'sfx/face_hit_Large_29.wav', 'sfx/face_hit_Large_78.wav'],
                volume: 0.7
            },
            
            // Finisher / KO sounds
            ko: {
                files: ['sfx/body_hit_finisher_23.wav', 'sfx/body_hit_finisher_42.wav', 'sfx/face_hit_finisher_19.wav'],
                volume: 0.9
            },
            
            // Jump sound
            jump: {
                files: ['sfx/somersalt_01.wav', 'sfx/somersalt_10.wav'],
                volume: 0.3
            },
            
            // Landing sound (using a subtle hit)
            land: {
                files: ['sfx/block_small_69.wav', 'sfx/block_small_73.wav'],
                volume: 0.25
            },
            
            // Special attack sounds
            firePunch: {
                files: ['sfx/fire_punch_02.wav', 'sfx/fire_punch_finisher_06.wav'],
                volume: 0.7
            },
            
            // Heavy hit sounds for high damage
            heavyHit: {
                files: ['sfx/face_hit_finisher_40.wav', 'sfx/face_hit_finisher_61.wav', 'sfx/bone_breaking_03.wav'],
                volume: 0.8
            }
        };
        
        // Preload all sounds
        this._preloadSounds();
    }
    
    /**
     * Preload all sound files
     */
    _preloadSounds() {
        console.log('[SFXManager] Preloading sounds...');
        
        for (const [category, config] of Object.entries(this.soundConfig)) {
            this.sounds[category] = [];
            
            config.files.forEach(file => {
                const audio = new Audio(file);
                audio.preload = 'auto';
                audio.volume = config.volume * this.masterVolume;
                
                // Handle load errors gracefully
                audio.onerror = () => {
                    console.warn(`[SFXManager] Failed to load: ${file}`);
                };
                
                this.sounds[category].push(audio);
            });
        }
        
        console.log('[SFXManager] Sound preloading initiated');
    }
    
    /**
     * Play a random sound from a category
     * @param {string} category - Sound category name
     * @param {number} volumeMultiplier - Optional volume multiplier (0-1)
     */
    play(category, volumeMultiplier = 1.0) {
        if (!this.enabled) return;
        
        const soundArray = this.sounds[category];
        if (!soundArray || soundArray.length === 0) {
            console.warn(`[SFXManager] Unknown sound category: ${category}`);
            return;
        }
        
        // Pick a random sound from the category
        const randomIndex = Math.floor(Math.random() * soundArray.length);
        const sound = soundArray[randomIndex];
        
        if (sound) {
            // Clone the audio to allow overlapping sounds
            const clone = sound.cloneNode();
            clone.volume = sound.volume * volumeMultiplier * this.masterVolume;
            
            // Play and auto-cleanup
            clone.play().catch(err => {
                // Ignore autoplay restrictions - user interaction will enable audio
                if (err.name !== 'NotAllowedError') {
                    console.warn('[SFXManager] Play error:', err);
                }
            });
        }
    }
    
    /**
     * Play punch attack sound (whoosh)
     */
    playPunchWhoosh() {
        this.play('punchWhoosh');
    }
    
    /**
     * Play punch impact sound
     * @param {number} damage - Damage amount to determine intensity
     */
    playPunchHit(damage = 10) {
        if (damage > 20) {
            this.play('hitLarge');
        } else {
            this.play('punchHit');
        }
    }
    
    /**
     * Play kick attack sound (whoosh)
     */
    playKickWhoosh() {
        this.play('kickWhoosh');
    }
    
    /**
     * Play kick impact sound
     * @param {number} damage - Damage amount to determine intensity
     */
    playKickHit(damage = 15) {
        if (damage > 25) {
            this.play('hitLarge');
        } else {
            this.play('kickHit');
        }
    }
    
    /**
     * Play block sound
     */
    playBlock() {
        this.play('block');
    }
    
    /**
     * Play hit reaction sound
     * @param {number} damage - Damage amount
     * @param {boolean} blocked - Whether the hit was blocked
     */
    playHit(damage = 10, blocked = false) {
        if (blocked) {
            this.play('block');
        } else if (damage > 30) {
            this.play('heavyHit');
        } else if (damage > 15) {
            this.play('hitLarge');
        } else {
            this.play('hitSmall');
        }
    }
    
    /**
     * Play KO sound
     */
    playKO() {
        this.play('ko');
    }
    
    /**
     * Play jump sound
     */
    playJump() {
        this.play('jump', 0.6);
    }
    
    /**
     * Play landing sound
     * @param {number} intensity - Landing intensity (0-1)
     */
    playLand(intensity = 0.5) {
        this.play('land', intensity);
    }
    
    /**
     * Play special/fire punch sound
     */
    playFirePunch() {
        this.play('firePunch');
    }
    
    /**
     * Set master volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        
        // Update all loaded sounds
        for (const soundArray of Object.values(this.sounds)) {
            soundArray.forEach(sound => {
                const category = Object.keys(this.sounds).find(
                    key => this.sounds[key].includes(sound)
                );
                if (category && this.soundConfig[category]) {
                    sound.volume = this.soundConfig[category].volume * this.masterVolume;
                }
            });
        }
    }
    
    /**
     * Enable/disable sound effects
     * @param {boolean} enabled - Whether sounds are enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    /**
     * Toggle sound effects
     * @returns {boolean} New enabled state
     */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
}

// Expose to global scope
if (typeof window !== 'undefined') {
    window.SFXManager = SFXManager;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SFXManager;
}

