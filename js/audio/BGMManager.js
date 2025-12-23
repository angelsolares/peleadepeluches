/**
 * BGMManager - Background Music Manager
 * Handles all background music playback, transitions, and looping
 */
class BGMManager {
    constructor() {
        this.currentTrack = null;
        this.currentAudio = null;
        this.enabled = true;
        this.masterVolume = 0.5;
        this.fadeTime = 1000; // Fade duration in ms
        
        // BGM categories
        this.tracks = {
            // Battle music (random selection)
            battle: [
                'bgm/Arena_of_Titans_2025-12-23T024025.mp3',
                'bgm/Neon_Combat_Zone_2025-12-23T023348.mp3',
                'bgm/Pixel_Arena_Clash_2025-12-23T023724.mp3',
                'bgm/Pixel_Fury_2025-12-23T022942.mp3'
            ],
            // Victory fanfare
            victory: 'bgm/Victory_Fanfare_2025-12-23T024226.mp3',
            // KO/Knockout sound
            knockout: 'bgm/Knockout_Impact_2025-12-23T024555.mp3',
            // Character select / Lobby
            characterSelect: 'bgm/Choose_Your_Challenger_2025-12-23T025104.mp3'
        };
        
        // Preloaded audio elements
        this.audioCache = {};
        
        // Preload all tracks
        this._preloadTracks();
        
        console.log('[BGMManager] Initialized');
    }
    
    /**
     * Preload all BGM tracks
     */
    _preloadTracks() {
        console.log('[BGMManager] Preloading tracks...');
        
        // Preload battle tracks
        this.tracks.battle.forEach(track => {
            this._preloadTrack(track, true);
        });
        
        // Preload other tracks
        this._preloadTrack(this.tracks.victory, false);
        this._preloadTrack(this.tracks.knockout, false);
        this._preloadTrack(this.tracks.characterSelect, true);
        
        console.log('[BGMManager] Preloading initiated');
    }
    
    /**
     * Preload a single track
     */
    _preloadTrack(src, loop = true) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.loop = loop;
        audio.volume = 0;
        
        audio.onerror = () => {
            console.warn(`[BGMManager] Failed to load: ${src}`);
        };
        
        this.audioCache[src] = audio;
    }
    
    /**
     * Play a track with optional fade in
     * @param {string} src - Track source path
     * @param {boolean} loop - Whether to loop the track
     * @param {boolean} fadeIn - Whether to fade in
     */
    _playTrack(src, loop = true, fadeIn = true) {
        if (!this.enabled) return;
        
        // Get or create audio element
        let audio = this.audioCache[src];
        if (!audio) {
            audio = new Audio(src);
            audio.preload = 'auto';
            this.audioCache[src] = audio;
        }
        
        audio.loop = loop;
        audio.currentTime = 0;
        
        if (fadeIn) {
            audio.volume = 0;
            audio.play().catch(err => {
                if (err.name !== 'NotAllowedError') {
                    console.warn('[BGMManager] Play error:', err);
                }
            });
            this._fadeIn(audio);
        } else {
            audio.volume = this.masterVolume;
            audio.play().catch(err => {
                if (err.name !== 'NotAllowedError') {
                    console.warn('[BGMManager] Play error:', err);
                }
            });
        }
        
        this.currentAudio = audio;
        this.currentTrack = src;
    }
    
    /**
     * Fade in audio
     */
    _fadeIn(audio, duration = null) {
        const fadeDuration = duration || this.fadeTime;
        const targetVolume = this.masterVolume;
        const steps = 20;
        const stepTime = fadeDuration / steps;
        const volumeStep = targetVolume / steps;
        
        let currentStep = 0;
        const fadeInterval = setInterval(() => {
            currentStep++;
            audio.volume = Math.min(targetVolume, volumeStep * currentStep);
            
            if (currentStep >= steps) {
                clearInterval(fadeInterval);
                audio.volume = targetVolume;
            }
        }, stepTime);
    }
    
    /**
     * Fade out audio
     */
    _fadeOut(audio, duration = null, callback = null) {
        if (!audio) return;
        
        const fadeDuration = duration || this.fadeTime;
        const startVolume = audio.volume;
        const steps = 20;
        const stepTime = fadeDuration / steps;
        const volumeStep = startVolume / steps;
        
        let currentStep = 0;
        const fadeInterval = setInterval(() => {
            currentStep++;
            audio.volume = Math.max(0, startVolume - (volumeStep * currentStep));
            
            if (currentStep >= steps) {
                clearInterval(fadeInterval);
                audio.volume = 0;
                audio.pause();
                audio.currentTime = 0;
                if (callback) callback();
            }
        }, stepTime);
    }
    
    /**
     * Stop current track with fade out
     */
    stop(fadeOut = true) {
        if (!this.currentAudio) return;
        
        if (fadeOut) {
            this._fadeOut(this.currentAudio);
        } else {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio.volume = 0;
        }
        
        this.currentTrack = null;
    }
    
    /**
     * Play random battle music
     */
    playBattle() {
        // Stop current track first
        if (this.currentAudio && this.currentTrack) {
            this._fadeOut(this.currentAudio, 500, () => {
                const randomTrack = this.tracks.battle[Math.floor(Math.random() * this.tracks.battle.length)];
                console.log('[BGMManager] Playing battle track:', randomTrack);
                this._playTrack(randomTrack, true, true);
            });
        } else {
            const randomTrack = this.tracks.battle[Math.floor(Math.random() * this.tracks.battle.length)];
            console.log('[BGMManager] Playing battle track:', randomTrack);
            this._playTrack(randomTrack, true, true);
        }
    }
    
    /**
     * Play character select / lobby music
     */
    playCharacterSelect() {
        if (this.currentTrack === this.tracks.characterSelect) return;
        
        if (this.currentAudio) {
            this._fadeOut(this.currentAudio, 500, () => {
                console.log('[BGMManager] Playing character select music');
                this._playTrack(this.tracks.characterSelect, true, true);
            });
        } else {
            console.log('[BGMManager] Playing character select music');
            this._playTrack(this.tracks.characterSelect, true, true);
        }
    }
    
    /**
     * Play victory fanfare (no loop)
     */
    playVictory() {
        // Stop battle music
        if (this.currentAudio) {
            this._fadeOut(this.currentAudio, 300);
        }
        
        console.log('[BGMManager] Playing victory fanfare');
        
        // Play victory without loop
        setTimeout(() => {
            this._playTrack(this.tracks.victory, false, false);
        }, 400);
    }
    
    /**
     * Play knockout sound (no loop, short)
     */
    playKnockout() {
        console.log('[BGMManager] Playing knockout sound');
        
        // Play knockout sound without stopping battle music
        // Create a separate audio for KO so it overlays
        const koAudio = new Audio(this.tracks.knockout);
        koAudio.volume = this.masterVolume * 1.2; // Slightly louder
        koAudio.play().catch(err => {
            if (err.name !== 'NotAllowedError') {
                console.warn('[BGMManager] KO play error:', err);
            }
        });
    }
    
    /**
     * Set master volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        
        if (this.currentAudio) {
            this.currentAudio.volume = this.masterVolume;
        }
    }
    
    /**
     * Enable/disable BGM
     * @param {boolean} enabled - Whether BGM is enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (!enabled && this.currentAudio) {
            this.stop(false);
        }
    }
    
    /**
     * Toggle BGM
     * @returns {boolean} New enabled state
     */
    toggle() {
        this.enabled = !this.enabled;
        
        if (!this.enabled && this.currentAudio) {
            this.stop(false);
        }
        
        return this.enabled;
    }
    
    /**
     * Pause current track
     */
    pause() {
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
    }
    
    /**
     * Resume current track
     */
    resume() {
        if (this.currentAudio && this.enabled) {
            this.currentAudio.play().catch(err => {
                if (err.name !== 'NotAllowedError') {
                    console.warn('[BGMManager] Resume error:', err);
                }
            });
        }
    }
}

// Expose to global scope
if (typeof window !== 'undefined') {
    window.BGMManager = BGMManager;
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BGMManager;
}

