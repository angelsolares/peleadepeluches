/**
 * FlappyGame.js - Multiplayer Flappy Bird mode
 * Up to 4 players compete to fly the farthest without hitting obstacles
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER_URL } from '../config.js';
import TournamentManager from '../tournament/TournamentManager.js';

// Character Models Configuration
const CHARACTER_MODELS = {
    'edgar': { path: 'assets/Edgar_Model.fbx', color: '#ff4444', name: 'Edgar' },
    'angel': { path: 'assets/Angel.fbx', color: '#4444ff', name: 'Angel' },
    'hector': { path: 'assets/Hector.fbx', color: '#44ff44', name: 'Hector' },
    'jesus': { path: 'assets/Jesus_Model.fbx', color: '#ffff44', name: 'Jesus' },
    'katy': { path: 'assets/Katy.fbx', color: '#ff44ff', name: 'Katy' },
    'isabella': { path: 'assets/Isabella_Model.fbx', color: '#44ffff', name: 'Isabella' },
    'lia': { path: 'assets/Lia_Model.fbx', color: '#ff8844', name: 'Lia' },
    'lidia': { path: 'assets/Lidia.fbx', color: '#ff8800', name: 'Lidia' },
    'fabian': { path: 'assets/Fabian.fbx', color: '#3399ff', name: 'Fabian' },
    'marile': { path: 'assets/Marile.fbx', color: '#ff99cc', name: 'Marile' },
    'mariana': { path: 'assets/Mariana.fbx', color: '#cc66ff', name: 'Mariana' },
    'gabriel': { path: 'assets/Gabriel.fbx', color: '#66ccff', name: 'Gabriel' },
    'sol': { path: 'assets/Sol.fbx', color: '#ffcc00', name: 'Sol' },
    'yadira': { path: 'assets/Yadira.fbx', color: '#ff6699', name: 'Yadira' }
};

// Animation Files
const ANIMATION_FILES = {
    flying: 'assets/Flying.fbx'
};

// Game Configuration
const GAME_CONFIG = {
    gravity: -25,
    flapStrength: 12,
    gameSpeed: 8,
    pipeGap: 6,
    pipeWidth: 2,
    pipeSpacing: 12,
    groundY: -8,
    ceilingY: 10,
    playerStartX: -5,
    playerSpacing: 1.5,
    maxPlayers: 4
};

// Lane colors for players
const LANE_COLORS = ['#ff4444', '#44ff44', '#4444ff', '#ffff44'];

/**
 * FlappyPlayerEntity - Represents a player in Flappy mode
 */
class FlappyPlayerEntity {
    constructor(playerData, model, animations, scene) {
        this.id = playerData.id;
        this.name = playerData.name;
        this.lane = playerData.lane || 0;
        this.color = LANE_COLORS[this.lane] || '#ffffff';
        this.scene = scene;
        
        this.isAlive = true;
        this.y = 0;
        this.velocity = 0;
        this.lastVelocity = 0;  // Track velocity changes for flap detection
        this.distance = 0;
        
        // Clone model
        this.model = SkeletonUtils.clone(model);
        this.model.scale.set(0.01, 0.01, 0.01);
        
        // Position based on lane
        const startX = GAME_CONFIG.playerStartX;
        const laneZ = (this.lane - (GAME_CONFIG.maxPlayers - 1) / 2) * GAME_CONFIG.playerSpacing;
        this.model.position.set(startX, 0, laneZ);
        
        // Rotate to face right (direction of flight)
        this.model.rotation.y = Math.PI / 2;
        
        // Apply color tint
        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                const mat = child.material.clone();
                mat.transparent = false;
                mat.opacity = 1.0;
                mat.depthWrite = true;
                mat.depthTest = true;
                child.material = mat;
            }
        });
        
        scene.add(this.model);
        
        // Setup animations
        this.mixer = new THREE.AnimationMixer(this.model);
        this.animations = {};
        this.currentAction = null;
        
        // Clone animations
        for (const [name, clip] of Object.entries(animations)) {
            this.animations[name] = clip.clone();
        }
        
        // Start with flying animation
        this.playAnimation('flying');
        
        // Create name label
        this.createNameLabel(scene);
        
        // Create particle system for flap effect
        this.createParticleSystem(scene);
    }
    
    createParticleSystem(scene) {
        // Create particle geometry
        const particleCount = 30;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const lifetimes = new Float32Array(particleCount);
        
        // Parse player color
        const colorObj = new THREE.Color(this.color);
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            
            velocities[i * 3] = 0;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 2] = 0;
            
            colors[i * 3] = colorObj.r;
            colors[i * 3 + 1] = colorObj.g;
            colors[i * 3 + 2] = colorObj.b;
            
            sizes[i] = 0;
            lifetimes[i] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // Store velocities and lifetimes separately
        this.particleVelocities = velocities;
        this.particleLifetimes = lifetimes;
        this.particleCount = particleCount;
        this.activeParticles = 0;
        
        // Create particle material with glow effect
        const material = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        
        this.particles = new THREE.Points(geometry, material);
        scene.add(this.particles);
    }
    
    emitFlapParticles() {
        if (!this.particles || !this.isAlive) return;
        
        const positions = this.particles.geometry.attributes.position.array;
        const colors = this.particles.geometry.attributes.color.array;
        const sizes = this.particles.geometry.attributes.size.array;
        
        // Get player position
        const px = this.model.position.x;
        const py = this.model.position.y;
        const pz = this.model.position.z;
        
        // Emit particles from behind and below the player
        for (let i = 0; i < this.particleCount; i++) {
            // Reset particle at player position with offset
            positions[i * 3] = px - 0.5 - Math.random() * 0.5;  // Behind player
            positions[i * 3 + 1] = py - 0.3 + (Math.random() - 0.5) * 0.3;  // Below player
            positions[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.5;
            
            // Random velocity (mostly backward and down)
            this.particleVelocities[i * 3] = -2 - Math.random() * 3;  // Backward
            this.particleVelocities[i * 3 + 1] = -1 - Math.random() * 2;  // Down
            this.particleVelocities[i * 3 + 2] = (Math.random() - 0.5) * 2;  // Side spread
            
            // Bright colors (yellow/orange/white)
            const brightness = 0.7 + Math.random() * 0.3;
            colors[i * 3] = 1.0;  // R
            colors[i * 3 + 1] = 0.6 + Math.random() * 0.4;  // G
            colors[i * 3 + 2] = Math.random() * 0.3;  // B
            
            sizes[i] = 0.2 + Math.random() * 0.3;
            this.particleLifetimes[i] = 0.5 + Math.random() * 0.3;  // Lifetime in seconds
        }
        
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
        this.activeParticles = this.particleCount;
    }
    
    updateParticles(deltaTime) {
        if (!this.particles || this.activeParticles === 0) return;
        
        const positions = this.particles.geometry.attributes.position.array;
        const sizes = this.particles.geometry.attributes.size.array;
        
        let stillActive = 0;
        
        for (let i = 0; i < this.particleCount; i++) {
            if (this.particleLifetimes[i] <= 0) continue;
            
            // Update lifetime
            this.particleLifetimes[i] -= deltaTime;
            
            if (this.particleLifetimes[i] <= 0) {
                sizes[i] = 0;
                continue;
            }
            
            stillActive++;
            
            // Update position based on velocity
            positions[i * 3] += this.particleVelocities[i * 3] * deltaTime;
            positions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * deltaTime;
            positions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * deltaTime;
            
            // Fade out size based on remaining lifetime
            const lifeRatio = this.particleLifetimes[i] / 0.5;
            sizes[i] *= 0.95;  // Shrink over time
        }
        
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
        this.activeParticles = stillActive;
    }
    
    createNameLabel(scene) {
        const labelDiv = document.createElement('div');
        labelDiv.className = 'player-name-label';
        labelDiv.textContent = this.name;
        labelDiv.style.cssText = `
            font-family: 'Orbitron', monospace;
            font-size: 14px;
            font-weight: bold;
            color: ${this.color};
            text-shadow: 0 0 5px ${this.color}, 0 0 10px rgba(0,0,0,0.8);
            background: rgba(0, 0, 0, 0.5);
            padding: 2px 8px;
            border-radius: 4px;
            white-space: nowrap;
        `;
        
        this.nameLabel = new CSS2DObject(labelDiv);
        this.nameLabel.position.set(0, 200, 0); // Adjusted for model scale
        this.model.add(this.nameLabel);
    }
    
    playAnimation(name) {
        if (!this.mixer || !this.animations[name]) return;
        
        if (this.currentAction) {
            this.currentAction.fadeOut(0.2);
        }
        
        const newAction = this.mixer.clipAction(this.animations[name]);
        newAction.setLoop(THREE.LoopRepeat, Infinity);
        newAction.reset();
        newAction.fadeIn(0.2);
        newAction.play();
        
        this.currentAction = newAction;
    }
    
    flap() {
        if (!this.isAlive) return;
        this.velocity = GAME_CONFIG.flapStrength;
        
        // Speed up animation on flap
        if (this.currentAction) {
            this.currentAction.timeScale = 2.0;
            setTimeout(() => {
                if (this.currentAction) {
                    this.currentAction.timeScale = 1.0;
                }
            }, 200);
        }
    }
    
    update(deltaTime, serverState) {
        if (this.mixer) {
            this.mixer.update(deltaTime);
        }
        
        if (serverState) {
            // Smooth interpolation to server state
            this.y = THREE.MathUtils.lerp(this.model.position.y, serverState.y, 0.3);
            this.model.position.y = this.y;
            this.isAlive = serverState.isAlive;
            this.distance = serverState.distance || 0;
            
            // Detect flap (significant positive velocity change)
            if (serverState.velocity !== undefined) {
                const velocityChange = serverState.velocity - this.lastVelocity;
                
                // If velocity jumped up significantly, it's a flap!
                if (velocityChange > 3 && serverState.velocity > 0) {
                    this.emitFlapParticles();
                    
                    // Speed up animation on flap
                    if (this.currentAction) {
                        this.currentAction.timeScale = 2.0;
                        setTimeout(() => {
                            if (this.currentAction) {
                                this.currentAction.timeScale = 1.0;
                            }
                        }, 200);
                    }
                }
                
                this.lastVelocity = serverState.velocity;
                
                // Tilt based on velocity
                const tiltAngle = THREE.MathUtils.clamp(serverState.velocity * 0.05, -0.5, 0.5);
                this.model.rotation.z = THREE.MathUtils.lerp(this.model.rotation.z, -tiltAngle, 0.1);
            }
        }
        
        // Update particles
        this.updateParticles(deltaTime);
        
        // Handle death visual
        if (!this.isAlive) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, 0.3, 0.05);
                    child.material.transparent = true;
                }
            });
        }
    }
    
    dispose(scene) {
        if (this.nameLabel) {
            this.model.remove(this.nameLabel);
        }
        scene.remove(this.model);
        if (this.mixer) {
            this.mixer.stopAllAction();
        }
        // Clean up particles
        if (this.particles) {
            scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
        }
    }
}

/**
 * FlappyGame - Main game class
 */
class FlappyGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        
        this.socket = null;
        this.roomCode = null;
        this.players = new Map();
        this.loadedModels = {};
        this.animations = {};
        
        this.pipes = [];
        this.ground = null;
        this.gameStarted = false;
        this.gameOver = false;
        this.currentDistance = 0;
        
        // Character selection from URL
        this.selectedCharacter = this.getCharacterFromURL() || 'angel';
        
        this.init();
    }
    
    getCharacterFromURL() {
        const params = new URLSearchParams(window.location.search);
        return params.get('character');
    }
    
    async init() {
        console.log('[FlappyGame] Initializing...');
        
        this.setupScene();
        this.setupLights();
        await this.loadAssets();
        this.setupSocket();
        this.animate();
        
        console.log('[FlappyGame] Initialization complete');
    }
    
    setupScene() {
        const container = document.getElementById('game-container');
        
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
        
        // Add fog for depth
        this.scene.fog = new THREE.Fog(0x87CEEB, 30, 80);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 2, 20);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('game-canvas'),
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        
        // CSS2D Renderer for labels
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        container.appendChild(this.labelRenderer.domElement);
        
        // Handle resize
        window.addEventListener('resize', () => this.onResize());
        
        // Create environment
        this.createEnvironment();
    }
    
    createEnvironment() {
        // Ground
        const groundGeometry = new THREE.PlaneGeometry(200, 20);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x228B22,
            roughness: 0.8
        });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = GAME_CONFIG.groundY;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
        
        // Ground details (grass lines)
        const grassGeometry = new THREE.PlaneGeometry(200, 0.5);
        const grassMaterial = new THREE.MeshStandardMaterial({
            color: 0x32CD32,
            roughness: 0.9
        });
        for (let i = 0; i < 5; i++) {
            const grass = new THREE.Mesh(grassGeometry, grassMaterial);
            grass.rotation.x = -Math.PI / 2;
            grass.position.set(0, GAME_CONFIG.groundY + 0.01, -3 + i * 1.5);
            this.scene.add(grass);
        }
        
        // Ceiling (invisible but for collision reference)
        const ceilingGeometry = new THREE.PlaneGeometry(200, 20);
        const ceilingMaterial = new THREE.MeshBasicMaterial({
            visible: false
        });
        const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = GAME_CONFIG.ceilingY;
        this.scene.add(ceiling);
        
        // Background clouds
        this.createClouds();
        
        // Sun
        const sunGeometry = new THREE.SphereGeometry(3, 32, 32);
        const sunMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFFF00,
            emissive: 0xFFFF00
        });
        const sun = new THREE.Mesh(sunGeometry, sunMaterial);
        sun.position.set(50, 30, -30);
        this.scene.add(sun);
    }
    
    createClouds() {
        const cloudGeometry = new THREE.SphereGeometry(1, 16, 16);
        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 1,
            transparent: true,
            opacity: 0.9
        });
        
        for (let i = 0; i < 15; i++) {
            const cloudGroup = new THREE.Group();
            
            // Create cloud from multiple spheres
            for (let j = 0; j < 5; j++) {
                const part = new THREE.Mesh(cloudGeometry, cloudMaterial);
                part.scale.set(
                    1 + Math.random(),
                    0.6 + Math.random() * 0.4,
                    1 + Math.random()
                );
                part.position.set(
                    j * 0.8 - 1.6,
                    Math.random() * 0.3,
                    Math.random() * 0.5
                );
                cloudGroup.add(part);
            }
            
            cloudGroup.position.set(
                Math.random() * 100 - 50,
                5 + Math.random() * 8,
                -10 - Math.random() * 20
            );
            cloudGroup.scale.setScalar(1.5 + Math.random() * 1.5);
            
            this.scene.add(cloudGroup);
        }
    }
    
    setupLights() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        
        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 1);
        directional.position.set(30, 30, 20);
        directional.castShadow = true;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;
        this.scene.add(directional);
        
        // Hemisphere light for natural sky lighting
        const hemisphere = new THREE.HemisphereLight(0x87CEEB, 0x228B22, 0.4);
        this.scene.add(hemisphere);
    }
    
    async loadAssets() {
        const loadingText = document.getElementById('loading-text');
        const progressFill = document.getElementById('progress-fill');
        
        const fbxLoader = new FBXLoader();
        
        try {
            // Load all character models
            let progress = 0;
            const totalModels = Object.keys(CHARACTER_MODELS).length;
            
            for (const key in CHARACTER_MODELS) {
                const charInfo = CHARACTER_MODELS[key];
                loadingText.textContent = `Cargando ${charInfo.name}...`;
                
                const model = await fbxLoader.loadAsync(charInfo.path);
                this.loadedModels[key] = model;
                
                progress++;
                progressFill.style.width = `${(progress / totalModels) * 60}%`;
            }
            
            // Load animations
            loadingText.textContent = 'Cargando animaciones...';
            progressFill.style.width = '70%';
            
            const flyingAnim = await fbxLoader.loadAsync(ANIMATION_FILES.flying);
            if (flyingAnim.animations && flyingAnim.animations.length > 0) {
                this.animations.flying = flyingAnim.animations[0];
            }
            
            progressFill.style.width = '100%';
            loadingText.textContent = '¡Listo!';
            
            // Hide loading screen
            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
            }, 500);
            
        } catch (error) {
            console.error('Error loading assets:', error);
            loadingText.textContent = 'Error cargando recursos';
        }
    }
    
    setupSocket() {
        console.log('[FlappyGame] Connecting to server...');
        this.socket = io(SERVER_URL);
        
        this.socket.on('connect', () => {
            console.log('[FlappyGame] Connected to server');
            this.createRoom();
        });
        
        this.socket.on('room-created', (data) => {
            console.log('[FlappyGame] Room created:', data);
            this.roomCode = data.roomCode;
            this.showRoomCode();
        });
        
        this.socket.on('player-joined', (data) => {
            console.log('[FlappyGame] Player joined:', data);
            // Extract player data from the event
            const playerData = data.player || data;
            this.addPlayer(playerData);
            this.updateRoomOverlay();
        });
        
        this.socket.on('character-selected', (data) => {
            console.log('[FlappyGame] Character selected:', data);
            const characterKey = data.character.toLowerCase();
            const newName = CHARACTER_MODELS[characterKey]?.name || data.character;
            
            // Update player if already exists
            const player = this.players.get(data.playerId);
            if (player) {
                // Check if character changed
                if (player.character !== characterKey) {
                    console.log(`[FlappyGame] Changing character from ${player.character} to ${characterKey}`);
                    
                    // Get new model
                    const newSourceModel = this.loadedModels[characterKey];
                    if (newSourceModel) {
                        // Remove old name label from model first (it's a child of the model)
                        if (player.nameLabel) {
                            if (player.model) {
                                player.model.remove(player.nameLabel);
                            }
                            // Dispose the CSS2D element
                            if (player.nameLabel.element && player.nameLabel.element.parentNode) {
                                player.nameLabel.element.parentNode.removeChild(player.nameLabel.element);
                            }
                            player.nameLabel = null;
                        }
                        
                        // Remove old model from scene
                        if (player.model) {
                            this.scene.remove(player.model);
                        }
                        
                        // Clone new model
                        const newModel = SkeletonUtils.clone(newSourceModel);
                        newModel.scale.set(0.01, 0.01, 0.01);
                        
                        // Keep same position
                        const startX = GAME_CONFIG.playerStartX;
                        const laneZ = (player.lane - (GAME_CONFIG.maxPlayers - 1) / 2) * GAME_CONFIG.playerSpacing;
                        newModel.position.set(startX, 0, laneZ);
                        newModel.rotation.y = Math.PI / 2;
                        
                        // Apply materials
                        newModel.traverse((child) => {
                            if (child.isMesh && child.material) {
                                const mat = child.material.clone();
                                mat.transparent = false;
                                mat.opacity = 1.0;
                                mat.depthWrite = true;
                                mat.depthTest = true;
                                child.material = mat;
                            }
                        });
                        
                        this.scene.add(newModel);
                        player.model = newModel;
                        
                        // Setup new animation mixer
                        player.mixer = new THREE.AnimationMixer(newModel);
                        player.currentAction = null;
                        
                        // Play flying animation
                        if (this.animations.flying) {
                            const action = player.mixer.clipAction(this.animations.flying);
                            action.setLoop(THREE.LoopRepeat);
                            action.play();
                            player.currentAction = action;
                        }
                        
                        // Recreate name label
                        const labelDiv = document.createElement('div');
                        labelDiv.className = 'player-name-label';
                        labelDiv.textContent = newName;
                        labelDiv.style.cssText = `
                            color: white;
                            font-family: 'Bangers', cursive;
                            font-size: 16px;
                            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
                            background: rgba(0,0,0,0.5);
                            padding: 2px 8px;
                            border-radius: 4px;
                            white-space: nowrap;
                        `;
                        const nameLabel = new CSS2DObject(labelDiv);
                        nameLabel.position.set(0, 250, 0);
                        newModel.add(nameLabel);
                        player.nameLabel = nameLabel;
                    }
                }
                
                player.name = newName;
                player.character = characterKey;
                
                // Update label text
                if (player.nameLabel && player.nameLabel.element) {
                    player.nameLabel.element.textContent = newName;
                }
                
                this.updatePlayersPanel();
            } else {
                // Store pending character selection for when player is added
                if (!this.pendingCharacters) this.pendingCharacters = new Map();
                this.pendingCharacters.set(data.playerId, {
                    character: data.character,
                    name: newName
                });
            }
        });
        
        this.socket.on('player-left', (data) => {
            console.log('[FlappyGame] Player left:', data);
            this.removePlayer(data.id);
            this.updateRoomOverlay();
        });
        
        this.socket.on('game-started', (data) => {
            console.log('[FlappyGame] Game started:', data);
            if (data.gameMode === 'flappy') {
                this.showCountdown();
            }
        });
        
        this.socket.on('flappy-countdown', (data) => {
            console.log('[FlappyGame] Countdown:', data.count);
            this.updateCountdown(data.count);
        });
        
        this.socket.on('flappy-start', () => {
            console.log('[FlappyGame] Race start!');
            this.startGame();
        });
        
        this.socket.on('flappy-state', (data) => {
            this.handleFlappyState(data);
        });
        
        this.socket.on('flappy-player-died', (data) => {
            console.log('[FlappyGame] Player died:', data);
            this.handlePlayerDeath(data);
        });
        
        this.socket.on('flappy-game-over', (data) => {
            console.log('[FlappyGame] Game over:', data);
            this.showGameOver(data);
        });
        
        this.socket.on('disconnect', () => {
            console.log('[FlappyGame] Disconnected from server');
        });
        
        // Initialize tournament manager
        this.tournamentManager = new TournamentManager(this.socket, 'flappy');
    }
    
    createRoom() {
        this.socket.emit('create-room', {
            character: this.selectedCharacter,
            gameMode: 'flappy'
        }, (response) => {
            if (response && response.roomCode) {
                this.roomCode = response.roomCode;
                this.showRoomCode();
            }
        });
    }
    
    showRoomCode() {
        const overlay = document.getElementById('room-overlay');
        const codeDisplay = document.getElementById('room-code-display');
        const qrCode = document.getElementById('qr-code');
        const mobileLink = document.getElementById('mobile-link');
        
        overlay.classList.remove('hidden');
        codeDisplay.textContent = this.roomCode;
        
        // Generate QR code
        const mobileUrl = `${window.location.origin}/mobile/?room=${this.roomCode}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}`;
        qrCode.src = qrUrl;
        
        mobileLink.href = mobileUrl;
        mobileLink.textContent = mobileUrl;
        
        // Setup start button
        const startBtn = document.getElementById('start-game-btn');
        startBtn.onclick = () => {
            if (this.players.size > 0) {
                this.socket.emit('start-game');
            }
        };
        
        // Setup rounds selector
        this.setupRoundsSelector();
    }
    
    setupRoundsSelector() {
        const roundBtns = document.querySelectorAll('.round-btn');
        roundBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rounds = parseInt(e.target.dataset.rounds);
                
                // Update UI
                roundBtns.forEach(b => b.classList.remove('selected'));
                e.target.classList.add('selected');
                
                // Send to server
                this.tournamentRounds = rounds;
                this.socket?.emit('set-tournament-rounds', rounds);
            });
        });
    }
    
    updateRoomOverlay() {
        const startBtn = document.getElementById('start-game-btn');
        const playersWaiting = document.getElementById('players-waiting');
        
        const playerCount = this.players.size;
        playersWaiting.textContent = playerCount > 0 
            ? `${playerCount}/${GAME_CONFIG.maxPlayers} jugadores conectados`
            : 'Esperando jugadores...';
        
        startBtn.disabled = playerCount === 0;
    }
    
    addPlayer(playerData) {
        if (this.players.has(playerData.id)) return;
        
        // Check for pending character selection
        let characterKey = (playerData.character || 'angel').toLowerCase();
        let playerName = playerData.characterName || playerData.name || CHARACTER_MODELS[characterKey]?.name || 'Player';
        
        if (this.pendingCharacters && this.pendingCharacters.has(playerData.id)) {
            const pending = this.pendingCharacters.get(playerData.id);
            characterKey = pending.character.toLowerCase();
            playerName = pending.name;
            this.pendingCharacters.delete(playerData.id);
        }
        
        let sourceModel = this.loadedModels[characterKey];
        
        if (!sourceModel) {
            console.warn(`[FlappyGame] Model not found for ${characterKey}, using angel`);
            sourceModel = this.loadedModels['angel'];
        }
        
        const player = new FlappyPlayerEntity(
            {
                id: playerData.id,
                name: playerName,
                character: characterKey,
                lane: this.players.size
            },
            sourceModel,
            this.animations,
            this.scene
        );
        
        this.players.set(playerData.id, player);
        this.updatePlayersPanel();
        console.log(`[FlappyGame] Added player: ${playerName} (${characterKey})`);
    }
    
    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.dispose(this.scene);
            this.players.delete(playerId);
            this.updatePlayersPanel();
        }
    }
    
    updatePlayersPanel() {
        const panel = document.getElementById('players-status');
        panel.innerHTML = '';
        
        this.players.forEach((player, id) => {
            const slot = document.createElement('div');
            slot.className = `player-slot ${player.isAlive ? 'alive' : 'dead'}`;
            slot.style.setProperty('--player-color', player.color);
            
            slot.innerHTML = `
                <div class="player-badge" style="background: ${player.color}">${player.lane + 1}</div>
                <span class="player-name">${player.name}</span>
                <span class="player-status-icon"></span>
            `;
            
            panel.appendChild(slot);
        });
        
        // Update survivors count
        const aliveCount = Array.from(this.players.values()).filter(p => p.isAlive).length;
        document.getElementById('survivors-count').textContent = `${aliveCount}/${this.players.size}`;
    }
    
    showCountdown() {
        const roomOverlay = document.getElementById('room-overlay');
        const countdownOverlay = document.getElementById('countdown-overlay');
        
        roomOverlay.classList.add('hidden');
        countdownOverlay.classList.remove('hidden');
    }
    
    updateCountdown(count) {
        const countdownNumber = document.getElementById('countdown-number');
        
        if (count > 0) {
            countdownNumber.textContent = count;
            countdownNumber.style.animation = 'none';
            void countdownNumber.offsetWidth; // Trigger reflow
            countdownNumber.style.animation = 'countdownPulse 0.5s ease-out';
        } else {
            countdownNumber.textContent = '¡VUELA!';
            countdownNumber.style.color = '#00ff88';
        }
    }
    
    startGame() {
        const countdownOverlay = document.getElementById('countdown-overlay');
        countdownOverlay.classList.add('hidden');
        
        this.gameStarted = true;
        this.gameOver = false;
        
        document.getElementById('state-text').textContent = '¡VOLANDO!';
    }
    
    handleFlappyState(data) {
        if (!data.players) return;
        
        // Update players
        for (const [playerId, state] of Object.entries(data.players)) {
            const player = this.players.get(playerId);
            if (player) {
                player.update(this.clock.getDelta(), state);
            }
        }
        
        // Update distance
        if (data.distance !== undefined) {
            this.currentDistance = data.distance;
            document.getElementById('distance-value').textContent = `${Math.floor(data.distance)}m`;
        }
        
        // Update pipes from server
        if (data.pipes) {
            this.updatePipes(data.pipes);
        }
        
        // Update players panel
        this.updatePlayersPanel();
    }
    
    updatePipes(serverPipes) {
        // Remove old pipes that are no longer in server state
        const serverPipeIds = new Set(serverPipes.map(p => p.id));
        
        this.pipes = this.pipes.filter(pipe => {
            if (!serverPipeIds.has(pipe.id)) {
                this.scene.remove(pipe.topMesh);
                this.scene.remove(pipe.bottomMesh);
                return false;
            }
            return true;
        });
        
        // Add or update pipes
        for (const serverPipe of serverPipes) {
            let pipe = this.pipes.find(p => p.id === serverPipe.id);
            
            if (!pipe) {
                // Create new pipe
                pipe = this.createPipe(serverPipe);
                this.pipes.push(pipe);
            }
            
            // Update position
            pipe.topMesh.position.x = serverPipe.x;
            pipe.bottomMesh.position.x = serverPipe.x;
        }
    }
    
    createPipe(pipeData) {
        const pipeGeometry = new THREE.BoxGeometry(
            GAME_CONFIG.pipeWidth,
            20,
            GAME_CONFIG.pipeWidth
        );
        
        const pipeMaterial = new THREE.MeshStandardMaterial({
            color: 0x2ECC71,
            roughness: 0.5,
            metalness: 0.2
        });
        
        // Top pipe
        const topMesh = new THREE.Mesh(pipeGeometry, pipeMaterial);
        topMesh.position.set(
            pipeData.x,
            pipeData.gapY + GAME_CONFIG.pipeGap / 2 + 10,
            0
        );
        topMesh.castShadow = true;
        this.scene.add(topMesh);
        
        // Bottom pipe
        const bottomMesh = new THREE.Mesh(pipeGeometry, pipeMaterial);
        bottomMesh.position.set(
            pipeData.x,
            pipeData.gapY - GAME_CONFIG.pipeGap / 2 - 10,
            0
        );
        bottomMesh.castShadow = true;
        this.scene.add(bottomMesh);
        
        // Pipe caps
        const capGeometry = new THREE.BoxGeometry(
            GAME_CONFIG.pipeWidth + 0.5,
            0.8,
            GAME_CONFIG.pipeWidth + 0.5
        );
        
        const topCap = new THREE.Mesh(capGeometry, pipeMaterial);
        topCap.position.y = -10;
        topMesh.add(topCap);
        
        const bottomCap = new THREE.Mesh(capGeometry, pipeMaterial);
        bottomCap.position.y = 10;
        bottomMesh.add(bottomCap);
        
        return {
            id: pipeData.id,
            topMesh,
            bottomMesh
        };
    }
    
    handlePlayerDeath(data) {
        const player = this.players.get(data.playerId);
        if (player) {
            player.isAlive = false;
            this.updatePlayersPanel();
        }
    }
    
    showGameOver(data) {
        this.gameOver = true;
        this.gameStarted = false;
        
        const overlay = document.getElementById('game-over-overlay');
        const winnerTitle = document.getElementById('winner-title');
        const winnerName = document.getElementById('winner-name');
        const finalScores = document.getElementById('final-scores');
        
        overlay.classList.remove('hidden');
        
        if (data.winner) {
            winnerTitle.textContent = '🏆 ¡GANADOR!';
            winnerName.textContent = data.winner.name;
        } else {
            winnerTitle.textContent = '💀 ¡TODOS CAYERON!';
            winnerName.textContent = '';
        }
        
        // Display final scores
        finalScores.innerHTML = '';
        if (data.results) {
            const sortedResults = data.results.sort((a, b) => b.distance - a.distance);
            
            sortedResults.forEach((result, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}°`;
                
                const item = document.createElement('div');
                item.className = 'final-score-item';
                item.innerHTML = `
                    <span class="rank">${medal}</span>
                    <span class="name">${result.name}</span>
                    <span class="distance">${Math.floor(result.distance)}m</span>
                `;
                finalScores.appendChild(item);
            });
        }
        
        // Play again button
        document.getElementById('play-again-btn').onclick = () => {
            window.location.reload();
        };
        
        document.getElementById('state-text').textContent = 'FIN DEL JUEGO';
    }
    
    updateCamera() {
        if (!this.gameStarted || this.players.size === 0) return;
        
        // Calculate center of alive players
        let totalX = 0;
        let totalY = 0;
        let aliveCount = 0;
        let minY = Infinity;
        let maxY = -Infinity;
        
        this.players.forEach(player => {
            if (player.isAlive) {
                totalX += player.model.position.x;
                totalY += player.model.position.y;
                minY = Math.min(minY, player.model.position.y);
                maxY = Math.max(maxY, player.model.position.y);
                aliveCount++;
            }
        });
        
        if (aliveCount === 0) return;
        
        const centerX = totalX / aliveCount;
        const centerY = totalY / aliveCount;
        
        // Calculate zoom based on spread
        const spreadY = maxY - minY;
        const baseDistance = 20;
        const zoomDistance = Math.max(baseDistance, baseDistance + spreadY);
        
        // Smooth camera follow
        const targetX = centerX + 5; // Look ahead
        const targetY = centerY + 2;
        const targetZ = zoomDistance;
        
        this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, 0.05);
        this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, 0.05);
        this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, 0.02);
        
        this.camera.lookAt(centerX, centerY, 0);
    }
    
    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
        this.labelRenderer.setSize(width, height);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const deltaTime = this.clock.getDelta();
        
        // Update players
        this.players.forEach(player => {
            if (player.mixer) {
                player.mixer.update(deltaTime);
            }
        });
        
        // Update camera
        if (this.gameStarted) {
            this.updateCamera();
        }
        
        // Render
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }
}

// Start game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new FlappyGame();
});

