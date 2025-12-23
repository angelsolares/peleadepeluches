/**
 * BGMManager - Background Music Manager (Mobile Version)
 * Handles all background music playback for the mobile controller
 */
class BGMManager {
    constructor(basePath = '../') {
        this.basePath = basePath;
        this.currentTrack = null;
        this.currentAudio = null;
        this.enabled = true;
        this.masterVolume = 0.5;
        this.fadeTime = 1000;
        
        // BGM categories
        this.tracks = {
            battle: [
                `${basePath}bgm/Arena_of_Titans_2025-12-23T024025.mp3`,
                `${basePath}bgm/Neon_Combat_Zone_2025-12-23T023348.mp3`,
                `${basePath}bgm/Pixel_Arena_Clash_2025-12-23T023724.mp3`,
                `${basePath}bgm/Pixel_Fury_2025-12-23T022942.mp3`
            ],
            victory: `${basePath}bgm/Victory_Fanfare_2025-12-23T024226.mp3`,
            knockout: `${basePath}bgm/Knockout_Impact_2025-12-23T024555.mp3`,
            characterSelect: `${basePath}bgm/Choose_Your_Challenger_2025-12-23T025104.mp3`
        };
        
        this.audioCache = {};
        this._preloadTracks();
        
        console.log('[BGMManager] Initialized (Mobile)');
    }
    
    _preloadTracks() {
        console.log('[BGMManager] Preloading tracks...');
        
        this.tracks.battle.forEach(track => {
            this._preloadTrack(track, true);
        });
        
        this._preloadTrack(this.tracks.victory, false);
        this._preloadTrack(this.tracks.knockout, false);
        this._preloadTrack(this.tracks.characterSelect, true);
    }
    
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
    
    _playTrack(src, loop = true, fadeIn = true) {
        if (!this.enabled) return;
        
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
    
    playBattle() {
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
    
    playVictory() {
        if (this.currentAudio) {
            this._fadeOut(this.currentAudio, 300);
        }
        
        console.log('[BGMManager] Playing victory fanfare');
        
        setTimeout(() => {
            this._playTrack(this.tracks.victory, false, false);
        }, 400);
    }
    
    playKnockout() {
        console.log('[BGMManager] Playing knockout sound');
        
        const koAudio = new Audio(this.tracks.knockout);
        koAudio.volume = this.masterVolume * 1.2;
        koAudio.play().catch(err => {
            if (err.name !== 'NotAllowedError') {
                console.warn('[BGMManager] KO play error:', err);
            }
        });
    }
    
    setVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        
        if (this.currentAudio) {
            this.currentAudio.volume = this.masterVolume;
        }
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (!enabled && this.currentAudio) {
            this.stop(false);
        }
    }
    
    toggle() {
        this.enabled = !this.enabled;
        
        if (!this.enabled && this.currentAudio) {
            this.stop(false);
        }
        
        return this.enabled;
    }
    
    // Resume after user interaction (required by browsers)
    resumeContext() {
        if (this.currentAudio && this.currentAudio.paused && this.enabled) {
            this.currentAudio.play().catch(() => {});
        }
    }
}

// Export for module use
export default BGMManager;

