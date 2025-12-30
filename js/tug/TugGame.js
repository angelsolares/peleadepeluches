/**
 * GUERRA DE CUERDA - Tug of War Game Mode
 * Three.js based tug of war game
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SERVER_URL, CONFIG } from '../config.js';
import { AnimationController, ANIMATION_CONFIG } from '../animation/AnimationController.js';

const TUG_CONFIG = {
    ROPE_LENGTH: 30, // Reduced from 40
    WIN_DISTANCE: 100, // From server
    PLAYER_SPACING: 2.5,
    SIDE_OFFSET: 5,
    CAMERA_HEIGHT: 12,
    CAMERA_DISTANCE: 25
};

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
    idle: 'Meshy_AI_Animation_Boxing_Guard_Prep_Straight_Punch_withSkin.fbx',
    pull: 'Meshy_AI_Animation_Grab_Held_withSkin.fbx', // Effort/Pulling
    win: 'Meshy_AI_Animation_Hip_Hop_Dance_withSkin.fbx',
    lose: 'Meshy_AI_Animation_Shot_and_Slow_Fall_Backward_withSkin.fbx'
};

class TugPlayerEntity {
    constructor(id, number, color, team, baseModel, baseAnimations) {
        this.id = id;
        this.number = number;
        this.color = color;
        this.team = team;
        this.name = `Player ${number}`;
        
        this.model = SkeletonUtils.clone(baseModel);
        // Correct scale and orientation (using negative Z like in main game to fix upside-down issue)
        this.model.scale.set(0.01, 0.01, -0.01);
        
        this.applyColorTint(color);
        
        this.nameLabel = this.createNameLabel(color);
        this.model.add(this.nameLabel);
        
        this.animController = new AnimationController(this.model, baseAnimations);
        this.isPulling = false;
        this.pullEndTime = 0;
    }
    
    createNameLabel(color) {
        const div = document.createElement('div');
        div.className = 'tug-player-name-label';
        div.textContent = this.name;
        div.style.color = color;
        const label = new CSS2DObject(div);
        label.position.set(0, 220, 0); // Corrected height for 0.01 scale
        return label;
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

    setName(name) {
        this.name = name;
        if (this.nameLabel && this.nameLabel.element) {
            this.nameLabel.element.textContent = name;
        }
    }

    update(delta, state) {
        if (state) {
            if (state.pullQuality > 0) {
                this.isPulling = true;
                this.pullEndTime = Date.now() + 500;
            }
        }

        if (this.isPulling && Date.now() > this.pullEndTime) {
            this.isPulling = false;
        }

        let animName = 'idle';
        if (this.isPulling) animName = 'pull';
        
        // Use play() to switch animations and update() for mixer
        this.animController.play(animName, 0.1);
        this.animController.update(delta);
    }
}

class TugGame {
    constructor() {
        this.players = new Map();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.clock = new THREE.Clock();
        this.socket = null;
        this.roomCode = null;
        this.gameStarted = false;
        
        this.baseModels = {};
        this.baseAnimations = {};
        
        this.rope = null;
        this.marker = null;
        this.markerPos = 0;
        
        this.init();
    }

    async init() {
        this.setupScene();
        this.setupLights();
        this.createArena();
        
        await this.loadAssets();
        this.connectToServer();
        this.animate();
        
        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a15);
        this.scene.fog = new THREE.Fog(0x0a0a15, 30, 100);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, TUG_CONFIG.CAMERA_HEIGHT, TUG_CONFIG.CAMERA_DISTANCE);
        this.camera.lookAt(0, 2, 0);

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
        
        this.addStyles();
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .tug-player-name-label {
                color: white;
                font-family: 'Orbitron', sans-serif;
                font-size: 10px;
                font-weight: bold;
                text-shadow: 0 0 10px rgba(0,0,0,0.8);
                padding: 2px 8px;
                background: rgba(0,0,0,0.6);
                border-radius: 5px;
                border: 1px solid currentColor;
                white-space: nowrap;
                pointer-events: none;
                text-transform: uppercase;
            }
            .rhythm-hud {
                position: fixed;
                top: 15%; /* Adjusted to be above the modal title area */
                left: 50%;
                transform: translateX(-50%);
                width: 400px;
                height: 40px;
                background: rgba(0,0,0,0.5);
                border: 2px solid rgba(255,255,255,0.2);
                border-radius: 20px;
                overflow: hidden;
                display: flex;
                align-items: center;
                z-index: 10;
            }
            .rhythm-target {
                position: absolute;
                width: 80px;
                height: 100%;
                background: rgba(0, 255, 204, 0.4);
                left: 160px;
                box-shadow: 0 0 20px rgba(0, 255, 204, 0.5);
                border-left: 2px solid #00ffcc;
                border-right: 2px solid #00ffcc;
            }
            .rhythm-cursor {
                position: absolute;
                width: 4px;
                height: 100%;
                background: white;
                box-shadow: 0 0 10px white;
            }
            .tug-status {
                position: fixed;
                top: 80px; /* Adjusted to avoid overlap */
                left: 50%;
                transform: translateX(-50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 2.5rem;
                font-weight: 900;
                color: white;
                text-align: center;
                pointer-events: none;
                z-index: 10;
                text-shadow: 0 0 20px #9966ff;
            }
            .tug-countdown {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-family: 'Orbitron', sans-serif;
                font-size: 10rem;
                font-weight: 900;
                color: white;
                text-shadow: 0 0 50px #9966ff;
                z-index: 100;
                pointer-events: none;
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);
    }

    createArena() {
        // Floor
        const floorGeo = new THREE.PlaneGeometry(100, 40);
        const floorMat = new THREE.MeshPhongMaterial({ color: 0x111122 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Lines
        const centerLineGeo = new THREE.PlaneGeometry(0.2, 40);
        const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
        const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.y = 0.01;
        this.scene.add(centerLine);

        // Win zones
        const createWinZone = (x, color) => {
            const zoneGeo = new THREE.PlaneGeometry(5, 40);
            const zoneMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.2 });
            const zone = new THREE.Mesh(zoneGeo, zoneMat);
            zone.rotation.x = -Math.PI / 2;
            zone.position.set(x, 0.01, 0);
            this.scene.add(zone);
        };
        createWinZone(-25, 0xff3366);
        createWinZone(25, 0x00ffcc);

        // Rope
        const ropeGeo = new THREE.CylinderGeometry(0.15, 0.15, TUG_CONFIG.ROPE_LENGTH, 12);
        const ropeMat = new THREE.MeshPhongMaterial({ color: 0x8b4513 }); // Brownish
        this.rope = new THREE.Mesh(ropeGeo, ropeMat);
        this.rope.rotation.z = Math.PI / 2;
        this.rope.position.y = 1.2; // Lowered to align with character hands
        this.scene.add(this.rope);

        // Marker (the flag on the rope)
        const markerGeo = new THREE.BoxGeometry(0.5, 1, 0.5);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.marker = new THREE.Mesh(markerGeo, markerMat);
        this.marker.position.y = 1.2; // Lowered to match rope
        this.scene.add(this.marker);
    }

    async loadAssets() {
        const loader = new FBXLoader();
        
        // Load all character models
        const modelPromises = Object.entries(CHARACTER_MODELS).map(async ([id, data]) => {
            try {
                const model = await loader.loadAsync(`assets/${data.file}`);
                this.baseModels[id] = model;
            } catch (e) {
                console.warn(`Failed to load model ${id}:`, e);
            }
        });
        
        await Promise.all(modelPromises);
        
        for (const [name, file] of Object.entries(ANIMATION_FILES)) {
            try {
                const anim = await loader.loadAsync(`assets/${file}`);
                this.baseAnimations[name] = anim.animations[0];
            } catch (e) {
                console.warn(`Failed to load animation ${name}:`, e);
            }
        }

        document.getElementById('loading-screen')?.classList.add('hidden');
    }

    connectToServer() {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
        script.onload = () => {
            this.socket = io(SERVER_URL);
            this.socket.on('connect', () => {
                this.socket.emit('create-room', { gameMode: 'tug' }, (response) => {
                    if (response.success) {
                        this.roomCode = response.roomCode;
                        this.showRoomUI(this.roomCode);
                    }
                });
            });

            this.socket.on('game-started', (data) => {
                this.gameStarted = true;
                this.hideRoomUI();
                this.setupPlayers(data.players);
                this.setupRhythmHUD();
            });

            this.socket.on('tug-state', (state) => this.updateGameState(state));
            this.socket.on('tug-game-over', (data) => this.showGameOver(data));
        };
        document.head.appendChild(script);
    }

    showRoomUI(code) {
        const overlay = document.createElement('div');
        overlay.id = 'tug-room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: rgba(10, 10, 21, 0.95); border: 4px solid #9966ff; border-radius: 24px;
            padding: 40px; text-align: center; font-family: 'Orbitron', sans-serif; z-index: 100;
            display: flex; flex-direction: column; align-items: center; gap: 20px;
            min-width: 400px; box-shadow: 0 0 50px rgba(0, 0, 0, 0.5);
        `;

        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}&bgcolor=ffffff`;

        overlay.innerHTML = `
            <h1 style="color: #9966ff; margin: 0;">GUERRA DE CUERDA</h1>
            <div style="font-size: 4rem; color: white; letter-spacing: 10px; font-weight: 900;">${code}</div>
            
            <div style="background: white; padding: 15px; border-radius: 16px; margin: 10px 0; box-shadow: 0 0 20px rgba(255,255,255,0.2);">
                <img src="${qrCodeUrl}" alt="QR Code" style="display: block; width: 200px; height: 200px;" />
            </div>

            <p style="color: rgba(255,255,255,0.6); margin: 0;">Escanea para unirte al equipo</p>
            <div id="player-count" style="font-size: 1.2rem; color: white;">Jugadores: 0 / 8</div>
            
            <button id="start-btn" style="
                padding: 15px 40px; background: #9966ff; border: none; border-radius: 12px;
                color: white; font-family: 'Orbitron'; font-size: 1.2rem; cursor: pointer;
                width: 100%; transition: all 0.3s; text-transform: uppercase; letter-spacing: 2px;
            " disabled>ESPERANDO JUGADORES...</button>
        `;
        document.body.appendChild(overlay);

        this.socket.on('player-joined', (data) => {
            const count = data.room.playerCount;
            const playerCountElem = document.getElementById('player-count');
            if (playerCountElem) playerCountElem.textContent = `Jugadores: ${count} / 8`;
            
            const btn = document.getElementById('start-btn');
            if (btn && count >= 2) {
                btn.disabled = false;
                btn.textContent = '¡INICIAR!';
            }
        });

        document.getElementById('start-btn').onclick = () => this.socket.emit('start-game');
    }

    hideRoomUI() {
        document.getElementById('tug-room-overlay')?.remove();
    }

    setupPlayers(playersData) {
        // Find which players are on which team to position them
        const teams = { left: [], right: [] };
        const assignedPlayers = playersData.map(p => {
            const team = p.team || (teams.left.length <= teams.right.length ? 'left' : 'right');
            const playerWithTeam = { ...p, team };
            teams[team].push(playerWithTeam);
            return playerWithTeam;
        });

        assignedPlayers.forEach((p) => {
            const team = p.team;
            const characterId = p.character || 'edgar';
            const baseModel = this.baseModels[characterId] || this.baseModels['edgar'];
            const entity = new TugPlayerEntity(p.id, p.number, p.color, team, baseModel, this.baseAnimations);
            entity.setName(p.name);
            
            this.players.set(p.id, entity);
            this.scene.add(entity.model);

            // Position based on team and index
            const teamPlayers = teams[team];
            const pIdx = teamPlayers.findIndex(tp => tp.id === p.id);
            const x = (team === 'left' ? -1 : 1) * (TUG_CONFIG.SIDE_OFFSET + pIdx * TUG_CONFIG.PLAYER_SPACING);
            const z = (pIdx % 2 === 0 ? 1 : -1) * 0.8; // Closer to the rope
            entity.model.position.set(x, 0.8, z); // Raised even more to align hands perfectly with rope at 1.2
            // Swapped signs: Left team faces X+, Right team faces X-
            entity.model.rotation.y = (team === 'left' ? -1 : 1) * Math.PI / 2;
        });
    }

    setupRhythmHUD() {
        const hud = document.createElement('div');
        hud.className = 'rhythm-hud';
        hud.innerHTML = `
            <div class="rhythm-target"></div>
            <div id="tug-rhythm-cursor" class="rhythm-cursor"></div>
        `;
        document.body.appendChild(hud);

        const status = document.createElement('div');
        status.id = 'tug-game-status';
        status.className = 'tug-status';
        status.textContent = '¡PREPÁRENSE!'; // Changed from ¡JALEN!
        document.body.appendChild(status);

        const countdown = document.createElement('div');
        countdown.id = 'tug-countdown';
        countdown.className = 'tug-countdown';
        document.body.appendChild(countdown);
    }

    updateGameState(state) {
        if (!state) return;

        // Handle countdown
        const countdownEl = document.getElementById('tug-countdown');
        const statusEl = document.getElementById('tug-game-status');
        
        if (state.gameState === 'countdown') {
            if (countdownEl) {
                countdownEl.style.display = 'block';
                countdownEl.textContent = state.countdown > 0 ? state.countdown : '¡YA!';
            }
            if (statusEl) statusEl.textContent = '¡PREPÁRENSE!';
            return; // Skip gameplay updates during countdown
        } else {
            if (countdownEl) countdownEl.style.display = 'none';
            if (statusEl && state.gameState === 'active') statusEl.textContent = '¡JALEN!';
        }

        // Update rope and marker position
        // Map server -100...100 to world -25...25
        const worldPos = (state.markerPos / 100) * 25;
        this.marker.position.x = worldPos;
        this.rope.position.x = worldPos;

        // Update rhythm cursor
        const now = Date.now();
        const pulseInterval = 1500;
        const progress = (now % pulseInterval) / pulseInterval;
        const cursor = document.getElementById('tug-rhythm-cursor');
        if (cursor) cursor.style.left = `${progress * 100}%`;

        // Update each player animation
        state.players.forEach(pState => {
            const entity = this.players.get(pState.id);
            if (entity) {
                entity.update(this.clock.getDelta(), pState);
            }
        });
    }

    showGameOver(data) {
        const winnerName = data.winnerTeam === 'left' ? 'EQUIPO IZQUIERDO' : 'EQUIPO DERECHO';
        const status = document.getElementById('tug-game-status');
        if (status) {
            status.innerHTML = `¡FIN DE LA PARTIDA!<br><span style="color: ${data.winnerTeam === 'left' ? '#ff3366' : '#00ffcc'}">${winnerName} GANA</span>`;
        }
        
        // Final animations
        this.players.forEach(entity => {
            const isWinner = entity.team === data.winnerTeam;
            entity.animController.update(0.1, isWinner ? 'win' : 'lose');
        });
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

new TugGame();

