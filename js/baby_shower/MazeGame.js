/**
 * MAZE GAME - Baby Shower Mode
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SERVER_URL } from '../config.js';
import { AnimationController } from '../animation/AnimationController.js';

class MazeGame {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.players = new Map();
        this.clock = new THREE.Clock();
        this.socket = null;
        this.roomCode = null;
        this.mazeGrid = null;
        this.baseModel = null;
        this.baseAnimations = {};
        
        this.init();
    }

    async init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xFFEFFA);
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(7.5, 20, 7.5); // Center of 15x15 maze
        this.camera.lookAt(7.5, 0, 7.5);

        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('game-canvas'),
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;

        this.setupLights();
        await this.loadAssets();
        this.connectToServer();
        this.animate();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        this.scene.add(dirLight);
    }

    async loadAssets() {
        const loader = new FBXLoader();
        // Load baby model as default
        this.baseModel = await loader.loadAsync('assets/bebe.fbx');
        
        const animFiles = {
            crawling: 'assets/Crawling.fbx',
            idle: 'assets/Meshy_AI_Animation_Walking_withSkin.fbx'
        };

        for (const [name, path] of Object.entries(animFiles)) {
            const anim = await loader.loadAsync(path);
            this.baseAnimations[name] = anim.animations[0];
        }

        document.getElementById('loading-screen')?.remove();
    }

    connectToServer() {
        this.socket = io(SERVER_URL);

        this.socket.on('connect', () => {
            this.socket.emit('create-room', { 
                gameMode: 'maze',
                isBabyShower: true 
            }, (response) => {
                if (response.success) {
                    this.roomCode = response.roomCode;
                    this.showRoomUI(this.roomCode, response.room);
                }
            });
        });

        this.socket.on('game-started', (data) => {
            this.hideRoomUI();
            this.setupMaze(data.mazeData || { grid: [], size: 15 });
        });

        this.socket.on('maze-state', (state) => this.updateGameState(state));
    }

    setupMaze(mazeData) {
        if (!mazeData.grid) return;
        this.mazeGrid = mazeData.grid;
        
        const wallGeo = new THREE.BoxGeometry(1, 1.5, 1);
        const wallMat = new THREE.MeshPhongMaterial({ color: 0xA2D2FF });
        
        const floorGeo = new THREE.PlaneGeometry(mazeData.size, mazeData.size);
        const floorMat = new THREE.MeshPhongMaterial({ color: 0xFFFFFF });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(mazeData.size/2 - 0.5, 0, mazeData.size/2 - 0.5);
        this.scene.add(floor);

        for (let z = 0; z < mazeData.size; z++) {
            for (let x = 0; x < mazeData.size; x++) {
                if (mazeData.grid[z][x] === 1) {
                    const wall = new THREE.Mesh(wallGeo, wallMat);
                    wall.position.set(x, 0.75, z);
                    wall.castShadow = true;
                    wall.receiveShadow = true;
                    this.scene.add(wall);
                }
            }
        }

        // Add finish marker
        const finishGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32);
        const finishMat = new THREE.MeshPhongMaterial({ color: 0xFFC8DD });
        const finish = new THREE.Mesh(finishGeo, finishMat);
        finish.position.set(14, 0.01, 14);
        this.scene.add(finish);
    }

    updateGameState(state) {
        if (!state) return;

        // Ensure maze is built if it wasn't
        if (!this.mazeGrid && state.grid) {
            this.setupMaze({ grid: state.grid, size: state.size || 15 });
        }

        // Update timer
        const timerElem = document.getElementById('time-val');
        if (timerElem) {
            const mins = Math.floor(state.timeLeft / 60);
            const secs = Math.floor(state.timeLeft % 60);
            timerElem.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        // Update players
        state.players.forEach(p => {
            let entity = this.players.get(p.id);
            if (!entity) {
                entity = this.createPlayerEntity(p);
                this.players.set(p.id, entity);
            }
            
            entity.model.position.set(p.x, 0, p.z);
            if (p.finished) {
                entity.model.visible = false;
            }
        });

        // Update winners list
        const winnersList = document.getElementById('winners-list');
        if (winnersList) {
            winnersList.innerHTML = '';
            state.winners.forEach((w, idx) => {
                const item = document.createElement('div');
                item.className = 'leader-item';
                item.innerHTML = `<span>${idx + 1}. ${w.name}</span> 🚩`;
                winnersList.appendChild(item);
            });
        }

        if (state.gameState === 'finished') {
            this.showGameOver(state.winners[0]);
        }
    }

    createPlayerEntity(p) {
        const model = SkeletonUtils.clone(this.baseModel);
        model.scale.set(0.005, 0.005, 0.005);
        this.scene.add(model);
        
        const animController = new AnimationController(model, this.baseAnimations);
        animController.play('crawling');
        
        return { model, animController };
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        
        this.players.forEach(p => p.animController.update(delta));
        this.renderer.render(this.scene, this.camera);
    }

    showRoomUI(code, roomData) {
        const overlay = document.createElement('div');
        overlay.id = 'room-overlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255, 239, 250, 0.95); z-index: 1000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: 'Orbitron', sans-serif;
        `;
        
        const mobileUrl = `${window.location.origin}/mobile/index.html?room=${code}`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(mobileUrl)}`;

        overlay.innerHTML = `
            <h1 style="font-size: 3.5rem; color: #FF99C8; margin-bottom: 10px;">BABY MAZE</h1>
            <div style="font-size: 5rem; color: #555; letter-spacing: 15px; margin-bottom: 20px;">${code}</div>
            <div style="background: white; padding: 20px; border-radius: 20px; margin-bottom: 20px;">
                <img src="${qrCodeUrl}" alt="QR" />
            </div>
            <div id="player-count-lobby" style="font-size: 1.5rem; color: #555; margin-bottom: 30px;">Jugadores: ${roomData ? roomData.playerCount : 0} / 8</div>
            <button id="start-btn" style="
                padding: 20px 60px; font-size: 1.5rem; background: #A2D2FF; color: white;
                border: none; border-radius: 50px; cursor: pointer;
            " ${roomData && roomData.playerCount >= 1 ? '' : 'disabled'}>¡INICIAR LABERINTO!</button>
        `;

        document.body.appendChild(overlay);

        document.getElementById('start-btn').onclick = () => {
            this.socket.emit('start-game');
        };
    }

    updatePlayerCountUI(roomData) {
        const countElem = document.getElementById('player-count-lobby');
        if (countElem) {
            countElem.textContent = `Jugadores: ${roomData.playerCount} / 8`;
        }
        const startBtn = document.getElementById('start-btn');
        if (startBtn) {
            startBtn.disabled = roomData.playerCount < 1;
        }
    }

    hideRoomUI() {
        document.getElementById('room-overlay')?.remove();
    }

    showGameOver(winner) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 2000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            color: white; font-family: 'Orbitron', sans-serif;
        `;
        overlay.innerHTML = `
            <h1 style="font-size: 4rem; margin-bottom: 20px;">¡LABERINTO COMPLETADO!</h1>
            <h2 style="font-size: 3rem; color: #FFC8DD;">GANADOR: ${winner ? winner.name : 'NADIE'}</h2>
            <button onclick="window.location.href='baby_shower.html'" style="
                margin-top: 40px; padding: 15px 40px; font-size: 1.2rem;
                background: white; color: #555; border: none; border-radius: 50px;
            ">VOLVER AL MENÚ</button>
        `;
        document.body.appendChild(overlay);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new MazeGame();

