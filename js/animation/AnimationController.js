/**
 * AnimationController - Shared Animation System
 * Used by both main game and playground for consistent animation behavior
 */

import * as THREE from 'three';

// =================================
// Animation Configuration
// =================================

export const ANIMATION_CONFIG = {
    // Animation file mappings
    files: {
        walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
        run: 'Meshy_AI_Animation_Running_withSkin.fbx',
        punch: 'Meshy_AI_Animation_Left_Uppercut_from_Guard_withSkin.fbx',
        kick: 'Meshy_AI_Animation_Boxing_Guard_Right_Straight_Kick_withSkin.fbx',
        hit: 'Meshy_AI_Animation_Hit_Reaction_1_withSkin.fbx',
        fall: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx',
        block: 'Meshy_AI_Animation_Block3_withSkin.fbx',
        taunt: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
    },
    
    // Animation types
    looping: ['walk', 'run', 'idle', 'pull'],
    oneShot: ['punch', 'kick', 'hit', 'fall', 'taunt', 'throw'],
    held: ['block', 'grab'],  // Animations that play once and hold on last frame while held
    
    // Default fade durations
    fadeDuration: {
        default: 0.15,
        toIdle: 0.2,
        toAttack: 0.1,
        toPull: 0.1
    },
    
    // Attack cooldowns (seconds) - reduced due to faster animations
    attackCooldown: {
        punch: 0.4,  // Faster recovery
        kick: 0.35,  // Faster recovery
        hit: 0.3,
        fall: 1.0,
        block: 0.1,  // Can release block quickly
        taunt: 2.0,   // Taunt takes time, risky!
        pull: 0.5
    },
    
    // Default animation speeds (multiplier)
    defaultSpeeds: {
        walk: 1.0,
        run: 1.0,
        punch: 2.0,  // Faster punch
        kick: 1.8,   // Faster kick
        hit: 1.5,    // Faster hit reaction
        fall: 1.2,   // Slightly faster fall
        block: 1.0,  // Normal block speed
        taunt: 1.0,  // Normal dance speed
        grab: 1.2,   // Grab animation speed
        throw: 1.5,   // Throw animation speed (faster for impact)
        pull: 1.0
    }
};

// Animation states
export const AnimationState = {
    IDLE: 'idle',
    WALK: 'walk',
    RUN: 'run',
    PUNCH: 'punch',
    KICK: 'kick',
    HIT: 'hit',
    BLOCK: 'block',
    TAUNT: 'taunt',
    FALL: 'fall',
    JUMP: 'jump'
};

// =================================
// AnimationController Class
// =================================

export class AnimationController {
    constructor(model, animations) {
        this.model = model;
        
        // Create mixer
        this.mixer = new THREE.AnimationMixer(model);
        
        // Store animations and create actions
        this.animations = animations;
        this.actions = {};
        
        // Current state
        this.currentAction = null;
        this.currentActionName = AnimationState.IDLE;
        this.previousActionName = null;
        
        // State flags
        this.isAttacking = false;
        this.isBlocking = false;
        this.isTaunting = false;
        this.isPaused = false;
        
        // Callbacks
        this.onAnimationFinished = null;
        this.onStateChange = null;
        
        // Initialize
        this._setupActions();
        this._setupEventListeners();
    }
    
    /**
     * Setup actions from animation clips
     */
    _setupActions() {
        for (const [name, clip] of Object.entries(this.animations)) {
            if (clip) {
                const action = this.mixer.clipAction(clip);
                this.actions[name] = action;
                this._configureAction(name, action);
            }
        }
    }
    
    /**
     * Configure individual action settings
     */
    _configureAction(name, action) {
        if (ANIMATION_CONFIG.looping.includes(name)) {
            action.setLoop(THREE.LoopRepeat);
            action.clampWhenFinished = false;
        } else if (ANIMATION_CONFIG.oneShot.includes(name)) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
        } else if (ANIMATION_CONFIG.held && ANIMATION_CONFIG.held.includes(name)) {
            // Held animations play once and freeze on last frame
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
        }
        
        // Apply default speed multiplier
        if (ANIMATION_CONFIG.defaultSpeeds[name]) {
            action.timeScale = ANIMATION_CONFIG.defaultSpeeds[name];
        }
    }
    
    /**
     * Setup mixer event listeners - KEY FIX for stuck animations
     */
    _setupEventListeners() {
        this.mixer.addEventListener('finished', (event) => {
            const finishedAction = event.action;
            const finishedName = this._getActionName(finishedAction);
            
            console.log(`[AnimationController] Animation finished: ${finishedName}`);
            
            // Check if this was a one-shot animation (not held animations like block)
            if (ANIMATION_CONFIG.oneShot.includes(finishedName)) {
                this.isAttacking = false;
                this.isTaunting = false;  // Reset taunt state
                
                // Return to idle or walk based on previous state
                // Use 'walk' as fallback if 'idle' doesn't exist
                let returnState = this.previousActionName === AnimationState.WALK || 
                                  this.previousActionName === AnimationState.RUN
                    ? this.previousActionName 
                    : AnimationState.IDLE;
                
                // If idle doesn't exist, use walk as default idle
                if (returnState === AnimationState.IDLE && !this.actions[AnimationState.IDLE]) {
                    returnState = AnimationState.WALK;
                }
                
                this.play(returnState, ANIMATION_CONFIG.fadeDuration.toIdle);
            }
            
            // Fire callback
            if (this.onAnimationFinished) {
                this.onAnimationFinished(finishedName);
            }
        });
    }
    
    /**
     * Get action name from action object
     */
    _getActionName(action) {
        for (const [name, act] of Object.entries(this.actions)) {
            if (act === action) return name;
        }
        return null;
    }
    
    /**
     * Play an animation by name
     */
    play(actionName, fadeDuration = ANIMATION_CONFIG.fadeDuration.default) {
        const newAction = this.actions[actionName];
        if (!newAction) {
            console.warn(`[AnimationController] Animation not found: ${actionName}`);
            return false;
        }
        
        // Don't interrupt if same animation is already playing (except for one-shots)
        if (this.currentAction === newAction && 
            newAction.isRunning() && 
            !ANIMATION_CONFIG.oneShot.includes(actionName)) {
            return false;
        }
        
        // Store previous state for return
        if (!ANIMATION_CONFIG.oneShot.includes(this.currentActionName)) {
            this.previousActionName = this.currentActionName;
        }
        
        // Reset and configure new action
        newAction.reset();
        newAction.paused = false;
        
        // Crossfade from current action
        if (this.currentAction && this.currentAction !== newAction) {
            this.currentAction.fadeOut(fadeDuration);
            newAction.fadeIn(fadeDuration);
        }
        
        newAction.play();
        this.currentAction = newAction;
        this.currentActionName = actionName;
        
        // Update attacking state
        if (ANIMATION_CONFIG.oneShot.includes(actionName)) {
            this.isAttacking = true;
        }
        
        // Fire state change callback
        if (this.onStateChange) {
            this.onStateChange(actionName, this.previousActionName);
        }
        
        return true;
    }
    
    /**
     * Play idle animation (walk paused)
     */
    playIdle() {
        if (this.isAttacking) return false;
        
        if (this.currentActionName !== AnimationState.WALK) {
            this.play(AnimationState.WALK, ANIMATION_CONFIG.fadeDuration.toIdle);
        }
        
        if (this.actions.walk) {
            this.actions.walk.paused = true;
        }
        
        this.currentActionName = AnimationState.IDLE;
        return true;
    }
    
    /**
     * Play walk animation
     */
    playWalk() {
        if (this.isAttacking) return false;
        
        if (this.currentActionName !== AnimationState.WALK) {
            this.play(AnimationState.WALK);
        }
        
        if (this.actions.walk) {
            this.actions.walk.paused = false;
        }
        
        return true;
    }
    
    /**
     * Play run animation
     */
    playRun() {
        if (this.isAttacking) return false;
        return this.play(AnimationState.RUN);
    }
    
    /**
     * Play punch animation
     */
    playPunch() {
        if (this.isAttacking) return false;
        return this.play(AnimationState.PUNCH, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Play kick animation
     */
    playKick() {
        if (this.isAttacking) return false;
        return this.play(AnimationState.KICK, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Play hit reaction animation
     */
    playHit() {
        return this.play(AnimationState.HIT, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Play fall/KO animation
     */
    playFall() {
        return this.play(AnimationState.FALL, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Play block animation (holds on last frame)
     */
    playBlock() {
        if (this.isAttacking) return false;
        this.isBlocking = true;
        return this.play(AnimationState.BLOCK, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Release block and return to idle
     */
    releaseBlock() {
        if (!this.isBlocking) return false;
        this.isBlocking = false;
        
        // Return to idle
        this.playIdle();
        return true;
    }
    
    /**
     * Play taunt/dance animation
     */
    playTaunt() {
        if (this.isAttacking || this.isBlocking || this.isTaunting) return false;
        this.isTaunting = true;
        return this.play(AnimationState.TAUNT, ANIMATION_CONFIG.fadeDuration.toAttack);
    }
    
    /**
     * Update animation based on movement state
     * @param {Object} state - { isMoving, isRunning, isGrounded, isJumping }
     */
    updateFromMovementState(state) {
        // Don't change animation during attack, block, or taunt
        if (this.isAttacking || this.isBlocking || this.isTaunting) return;
        
        const { isMoving, isRunning, isGrounded, isJumping } = state;
        
        // TODO: Add jump animation when available
        // if (!isGrounded || isJumping) { ... }
        
        if (isRunning && isMoving) {
            this.playRun();
        } else if (isMoving) {
            this.playWalk();
        } else {
            this.playIdle();
        }
    }
    
    /**
     * Update mixer - call each frame
     */
    update(delta) {
        this.mixer.update(delta);
    }
    
    /**
     * Get current animation info
     */
    getInfo() {
        const action = this.currentAction;
        return {
            name: this.currentActionName,
            time: action ? action.time : 0,
            duration: action ? action.getClip().duration : 0,
            isPlaying: action ? action.isRunning() : false,
            isPaused: action ? action.paused : false,
            isAttacking: this.isAttacking,
            loop: action ? action.loop : THREE.LoopRepeat
        };
    }
    
    /**
     * Stop all animations
     */
    stopAll() {
        this.mixer.stopAllAction();
        this.currentAction = null;
        this.currentActionName = AnimationState.IDLE;
        this.isAttacking = false;
        this.isBlocking = false;
        this.isTaunting = false;
    }
    
    /**
     * Set playback speed for a specific animation
     * @param {string} actionName - Name of the animation
     * @param {number} speed - Playback speed (1.0 = normal, 2.0 = double speed, 0.5 = half speed)
     */
    setAnimationSpeed(actionName, speed) {
        const action = this.actions[actionName];
        if (action) {
            action.timeScale = speed;
            console.log(`[AnimationController] Set ${actionName} speed to ${speed}x`);
            return true;
        }
        return false;
    }
    
    /**
     * Get playback speed for a specific animation
     * @param {string} actionName - Name of the animation
     * @returns {number} Current playback speed
     */
    getAnimationSpeed(actionName) {
        const action = this.actions[actionName];
        return action ? action.timeScale : 1.0;
    }
    
    /**
     * Set playback speeds for multiple animations at once
     * @param {Object} speeds - Object with animation names as keys and speeds as values
     */
    setAnimationSpeeds(speeds) {
        for (const [name, speed] of Object.entries(speeds)) {
            this.setAnimationSpeed(name, speed);
        }
    }
    
    /**
     * Dispose resources
     */
    dispose() {
        this.stopAll();
        this.mixer.uncacheRoot(this.model);
    }
}

export default AnimationController;

