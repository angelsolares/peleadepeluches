/**
 * TAG DE PELUCHES - Tag Game Mode
 * Three.js based tag game with top-down perspective
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';
import TagPlayerController from './TagPlayerController.js';
import TournamentManager from '../tournament/TournamentManager.js';

// =================================
// Configuration
// =================================

const TAG_CONFIG = {
    MAP_SIZE: 20,
    CAMERA_HEIGHT: 25,
    CAMERA_ANGLE: Math.PI / 3,
    PLAYER_COLORS: ['#ff3366', '#00ffcc', '#ffcc00', '#9966ff', '#ff6600', '#00ccff', '#ccff00', '#ff00ff']
};

// Character models
const CHARACTER_MODELS = {
    edgar: { name: 'Edgar', file: 'Edgar_Model.fbx' },
    isabella: { name: 'Isabella', file: 'Isabella_Model.fbx' },
    jesus: { name: 'Jesus', file: 'Jesus_Model.fbx' },
    lia: { name: 'Lia', file: 'Lia_Model.fbx' },
    hector: { name: 'Hector', file: 'Hector.fbx' },
    katy: { name: 'Katy', file: 'Katy.fbx' },
    mariana: { name: 'Mariana', file: 'Mariana.fbx' },
    sol: { name: 'Sol', file: 'Sol.fbx' },
    yadira: { name: 'Yadira', file: 'Yadira.fbx' },
    angel: { name: 'Angel', file: 'Angel.fbx' },
    lidia: { name: 'Lidia', file: 'Lidia.fbx' },
    fabian: { name: 'Fabian', file: 'Fabian.fbx' },
    marile: { name: 'Marile', file: 'Marile.fbx' },
    gabriel: { name: 'Gabriel', file: 'Gabriel.fbx' }
};

const ANIMATION_FILES = {
    walk: 'Meshy_AI_Animation_Walking_withSkin.fbx',
    run: 'Meshy_AI_Animation_Running_withSkin.fbx',
    idle: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx'
};

class TagPlayerEntity {
    constructor(id, number, color, baseModel, baseAnimations) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.name = `Player ${number}`;
        
        this.model = SkeletonUtils.clone(baseModel);
        this.model.scale.set(0.01, 0.01, 0.01);
        
        this.applyColorTint(color);
        
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);
        
        this.itLabel = this.createItLabel();
        this.itLabel.visible = false;
        this.model.add(this.itLabel);

        // Aura for "It" player
        this.aura = this.createAura();
        this.aura.visible = false;
        this.model.add(this.aura);
        
        this.animController = new AnimationController(this.model, baseAnimations);
        this.controller = new TagPlayerController(id, number, color);
    }
    
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'arena-player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 250, 0);
        return label;
    }

    createItLabel() {
        const div = document.createElement('div');
        div.className = 'tag-label-it';
        div.textContent = 'LA TRAE';
        const label = new CSS2DObject(div);
        label.position.set(0, 320, 0);
        return label;
    }

    createAura() {
        const geometry = new THREE.RingGeometry(1.2, 1.5, 32);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xff3366, 
            transparent: true, 
            opacity: 0.5, 
            side: THREE.DoubleSide 
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 5; // Slightly above ground in model space
        return mesh;
    }
    
    applyColorTint(color) {
        const tintColor = new THREE.Color(color);
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.material = child.material.clone();
                if (child.material.emissive) {
                    child.material.emissive = tintColor;
                    child.material.emissiveIntensity = 0.2;
                }
            }
        });
    }

    update(delta, state) {
        if (state) {
            this.controller.applyServerState(state);
            this.itLabel.visible = state.isIt;
            this.aura.visible = state.isIt;
            
            // Visual feedback for grace period (transparency)
            this.model.traverse(child => {
                if (child.isMesh) {
                    child.material.transparent = state.hasGrace;
                    child.material.opacity = state.hasGrace ? 0.5 : 1.0;
                }
            });
        }
        
        this.model.position.copy(this.controller.position);
        this.model.rotation.y = this.controller.facingAngle + Math.PI;
        
        const animState = this.controller.getMovementState();
        this.animController.update(delta, animState);
    }
}

class TagGame {
    constructor() {
        this.players = new Map();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        this.socket = null;
        this.roomCode = null;
        this.isHost = false;
        this.gameStarted = false;
        
        this.baseModels = {};
        this.baseAnimations = {};
        
        this.init();
    }

    async init() {
        this.setupScene();
        this.setupLights();
        this.createFloor();
        
        await this.loadAssets();
        this.connectToServer();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a15);
        this.scene.fog = new THREE.Fog(0x0a0a15, 20, 50);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, TAG_CONFIG.CAMERA_HEIGHT, TAG_CONFIG.CAMERA_HEIGHT / Math.tan(TAG_CONFIG.CAMERA_ANGLE));
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ 
            canvas: document.getElementById('game-canvas'),
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0px';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.getElementById('game-container').appendChild(this.labelRenderer.domElement);
    }

    setupLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1);
        sunLight.position.set(10, 20, 10);
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        this.scene.add(sunLight);
    }

    createFloor() {
        const geometry = new THREE.PlaneGeometry(TAG_CONFIG.MAP_SIZE, TAG_CONFIG.MAP_SIZE);
        const material = new THREE.MeshPhongMaterial({ 
            color: 0x1a1a2e,
            side: THREE.DoubleSide
        });
        const floor = new THREE.Mesh(geometry, material);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Add grid helper
        const grid = new THREE.GridHelper(TAG_CONFIG.MAP_SIZE, 20, 0xff3366, 0x333333);
        this.scene.add(grid);
    }

    async loadAssets() {
        const loader = new FBXLoader();
        const loadingManager = new THREE.LoadingManager();
        
        loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = (itemsLoaded / itemsTotal) * 100;
            const fill = document.getElementById('progress-fill');
            if (fill) fill.style.width = `${progress}%`;
        };

        // Load all character models
        const modelPromises = Object.entries(CHARACTER_MODELS).map(async ([id, data]) => {
            const model = await loader.loadAsync(`assets/${data.file}`);
            this.baseModels[id] = model;
        });
        
        await Promise.all(modelPromises);
        
        for (const [name, file] of Object.entries(ANIMATION_FILES)) {
            const anim = await loader.loadAsync(`assets/${file}`);
            this.baseAnimations[name] = anim.animations[0];
        }

        document.getElementById('loading-screen').classList.add('hidden');
    }

    connectToServer() {
        // ...
    }

    setupPlayers(playersData) {
        playersData.forEach((p, index) => {
            const characterId = p.character || 'edgar';
            const baseModel = this.baseModels[characterId] || this.baseModels['edgar'];
            
            const entity = new TagPlayerEntity(
                p.id, 
                p.number, 
                p.color, 
                baseModel, 
                this.baseAnimations
            );
            entity.setName(p.name);
            this.players.set(p.id, entity);
            this.scene.add(entity.model);
        });
    }

    updateGameState(state) {
        const timerElement = document.getElementById('match-timer');
        if (timerElement) {
            const seconds = Math.floor(state.remainingTime / 1000);
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            timerElement.textContent = `${m}:${s}`;
        }

        const playerList = document.getElementById('tag-player-list');
        if (playerList) {
            playerList.innerHTML = '';
            // Sort players by penalty time (ascending - lower is better)
            const sortedPlayers = [...state.players].sort((a, b) => a.penaltyTime - b.penaltyTime);
            
            sortedPlayers.forEach(p => {
                const item = document.createElement('div');
                item.className = `tag-player-item ${p.isIt ? 'is-it' : ''}`;
                item.style.setProperty('--player-color', p.color || '#fff');
                
                const penaltySec = (p.penaltyTime / 1000).toFixed(1);
                item.innerHTML = `
                    <span class="tag-player-name">${p.name} ${p.isIt ? '<span class="tag-badge">IT</span>' : ''}</span>
                    <span class="tag-penalty-time">${penaltySec}s</span>
                `;
                playerList.appendChild(item);
            });
        }

        state.players.forEach(pState => {
            const entity = this.players.get(pState.id);
            if (entity) {
                entity.update(this.clock.getDelta(), pState);
            }
        });

        const itAnnouncement = document.getElementById('it-announcement');
        if (itAnnouncement) {
            const itPlayer = state.players.find(p => p.isIt);
            if (itPlayer) {
                itAnnouncement.textContent = `¡${itPlayer.name.toUpperCase()} LA TRAE!`;
                itAnnouncement.style.color = itPlayer.color;
            }
        }
    }

    handleTagTransfer(data) {
        // Play sound or show effect
        console.log(`Tag transfer: ${data.oldItId} -> ${data.newItId}`);
    }

    showGameOver(data) {
        const overlay = document.getElementById('round-end-overlay');
        overlay.classList.remove('hidden');
        
        document.getElementById('round-title').textContent = '¡FIN DE LA PARTIDA!';
        document.getElementById('round-winner').textContent = `👑 ¡${data.winner.name} GANA!`;
        document.getElementById('round-winner').style.color = data.winner.color;

        const scoresContainer = document.getElementById('round-scores');
        scoresContainer.innerHTML = '<h3>TIEMPOS DE PENALIZACIÓN:</h3>';
        
        data.ranking.forEach((p, i) => {
            const pSec = (p.penaltyTime / 1000).toFixed(1);
            const row = document.createElement('div');
            row.style.margin = '10px 0';
            row.innerHTML = `${i + 1}. ${p.name}: <strong>${pSec}s</strong>`;
            scoresContainer.appendChild(row);
        });

        document.getElementById('next-round-countdown').classList.add('hidden');
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Start the game
new TagGame();

