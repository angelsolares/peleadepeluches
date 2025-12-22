/**
 * Animation Playground
 * Test and visualize animations in isolation
 * Uses shared AnimationController for consistency with main game
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { AnimationController, ANIMATION_CONFIG, AnimationState } from '../../js/animation/AnimationController.js';

// =================================
// Configuration
// =================================

// Camera positions - Side view is the default for 2D fighting game testing
const CAMERA_POSITIONS = {
    side: { x: 0, y: 1.5, z: 5 },    // TRUE side view - X movement appears horizontal
    front: { x: 0, y: 1.5, z: -4 },   // Looking at character's front (behind the stage)
    back: { x: 4, y: 1.5, z: 0 }      // 3/4 view from the side
};

// =================================
// Global Variables
// =================================

let scene, camera, renderer;
let clock = new THREE.Clock();

let model = null;
let animationController = null;
const animations = {};

// Movement state
const movementState = {
    left: false,
    right: false,
    run: false
};

let facingRight = true;
let positionX = 0;

// UI Elements
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const currentAnimationEl = document.getElementById('current-animation');
const animationTimeEl = document.getElementById('animation-time');
const animationDurationEl = document.getElementById('animation-duration');
const animationStatusEl = document.getElementById('animation-status');
const progressBar = document.getElementById('progress-bar');

// =================================
// Initialization
// =================================

async function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d1a);
    
    // Setup camera - Side view by default
    const canvas = document.getElementById('playground-canvas');
    const aspect = canvas.clientWidth / canvas.clientHeight;
    camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    camera.position.set(CAMERA_POSITIONS.side.x, CAMERA_POSITIONS.side.y, CAMERA_POSITIONS.side.z);
    camera.lookAt(0, 1, 0);
    
    // Setup renderer
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Setup lights
    setupLights();
    
    // Create ground
    createGround();
    
    // Load character and animations
    await loadCharacter();
    
    // Setup controls
    setupControls();
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Start render loop
    animate();
}

// =================================
// Lighting
// =================================

function setupLights() {
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(3, 8, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    scene.add(mainLight);
    
    const rimLight = new THREE.DirectionalLight(0xff3366, 0.5);
    rimLight.position.set(-3, 2, -3);
    scene.add(rimLight);
    
    const fillLight = new THREE.DirectionalLight(0x00ffcc, 0.3);
    fillLight.position.set(2, 1, -2);
    scene.add(fillLight);
}

// =================================
// Ground
// =================================

function createGround() {
    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        metalness: 0.2,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Grid helper
    const gridHelper = new THREE.GridHelper(20, 20, 0x333355, 0x222244);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);
    
    // Center marker
    const markerGeometry = new THREE.RingGeometry(0.3, 0.35, 32);
    const markerMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.01;
    scene.add(marker);
}

// =================================
// Character Loading
// =================================

async function loadCharacter() {
    const loader = new FBXLoader();
    const animationFiles = ANIMATION_CONFIG.files;
    const totalFiles = Object.keys(animationFiles).length;
    let loadedCount = 0;
    
    try {
        // Load base model (walk has the skinned mesh)
        loadingText.textContent = 'Cargando modelo...';
        model = await loadFBX(loader, `../assets/${animationFiles.walk}`);
        // Scale (will be adjusted based on facing direction)
        model.scale.set(0.01, 0.01, 0.01);
        
        // Rotate model 180 degrees so it faces the direction it walks
        model.rotation.y = Math.PI;
        
        // Enable shadows
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        // Store walk animation
        if (model.animations && model.animations.length > 0) {
            animations.walk = model.animations[0];
            loadedCount++;
        }
        
        // Load remaining animations
        for (const [actionName, fileName] of Object.entries(animationFiles)) {
            if (actionName === 'walk') continue;
            
            loadingText.textContent = `Cargando: ${actionName}...`;
            
            try {
                const animModel = await loadFBX(loader, `../assets/${fileName}`);
                
                if (animModel.animations && animModel.animations.length > 0) {
                    animations[actionName] = animModel.animations[0];
                    console.log(`[Playground] Loaded: ${actionName} (${animations[actionName].duration.toFixed(2)}s)`);
                }
                
                // Dispose temp model
                animModel.traverse((child) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => m.dispose());
                    }
                });
            } catch (err) {
                console.error(`[Playground] Failed to load ${actionName}:`, err);
            }
            
            loadedCount++;
            const progress = (loadedCount / totalFiles) * 100;
            loadingText.textContent = `Cargando animaciones: ${Math.round(progress)}%`;
        }
        
        // Add model to scene
        scene.add(model);
        
        // Create animation controller with shared module
        animationController = new AnimationController(model, animations);
        
        // Setup callbacks
        animationController.onAnimationFinished = (name) => {
            console.log(`[Playground] Animation finished: ${name}`);
            updateActiveButton();
        };
        
        animationController.onStateChange = (newState, oldState) => {
            console.log(`[Playground] State: ${oldState} -> ${newState}`);
            updateActiveButton();
        };
        
        // Start with idle
        animationController.playIdle();
        
        // Hide loading
        loadingOverlay.classList.add('hidden');
        
        // Set initial camera to side view
        setCameraPosition('side');
        
    } catch (error) {
        console.error('[Playground] Error loading character:', error);
        loadingText.textContent = 'Error al cargar el modelo';
    }
}

function loadFBX(loader, path) {
    return new Promise((resolve, reject) => {
        loader.load(path, resolve, undefined, reject);
    });
}

// =================================
// Controls Setup
// =================================

function setupControls() {
    // Animation buttons
    document.querySelectorAll('.anim-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const anim = btn.dataset.animation;
            playAnimation(anim);
        });
    });
    
    // Movement buttons
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    const chkRun = document.getElementById('chk-run');
    
    btnLeft.addEventListener('mousedown', () => setMovement('left', true));
    btnLeft.addEventListener('mouseup', () => setMovement('left', false));
    btnLeft.addEventListener('mouseleave', () => setMovement('left', false));
    
    btnRight.addEventListener('mousedown', () => setMovement('right', true));
    btnRight.addEventListener('mouseup', () => setMovement('right', false));
    btnRight.addEventListener('mouseleave', () => setMovement('right', false));
    
    chkRun.addEventListener('change', (e) => {
        movementState.run = e.target.checked;
    });
    
    // Camera buttons
    document.getElementById('btn-camera-front').addEventListener('click', () => setCameraPosition('front'));
    document.getElementById('btn-camera-side').addEventListener('click', () => setCameraPosition('side'));
    document.getElementById('btn-camera-back').addEventListener('click', () => setCameraPosition('back'));
    
    // Custom FBX file loader
    const fbxFileInput = document.getElementById('fbx-file-input');
    const fbxSelectBtn = document.getElementById('fbx-select-btn');
    
    // Click the hidden file input when button is clicked
    fbxSelectBtn.addEventListener('click', () => {
        fbxFileInput.click();
    });
    
    fbxFileInput.addEventListener('change', handleFBXUpload);
    
    // Keyboard controls
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
}

/**
 * Handle custom FBX file upload
 */
async function handleFBXUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const targetSlot = document.getElementById('fbx-target-slot').value;
    const statusEl = document.getElementById('fbx-status');
    
    // Show loading status
    statusEl.textContent = `Cargando ${file.name}...`;
    statusEl.className = 'fbx-status loading';
    
    try {
        const loader = new FBXLoader();
        const arrayBuffer = await file.arrayBuffer();
        
        // Create a blob URL from the file
        const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        // Load the FBX
        loader.load(url, (loadedModel) => {
            // Check if it has animations
            if (loadedModel.animations && loadedModel.animations.length > 0) {
                const newClip = loadedModel.animations[0];
                
                // Store the new animation
                animations[targetSlot] = newClip;
                
                // Recreate the animation controller with updated animations
                if (animationController) {
                    animationController.dispose();
                }
                animationController = new AnimationController(model, animations);
                
                // Setup callbacks again
                animationController.onAnimationFinished = (name) => {
                    console.log(`[Playground] Animation finished: ${name}`);
                    updateActiveButton();
                };
                
                animationController.onStateChange = (newState, oldState) => {
                    console.log(`[Playground] State: ${oldState} -> ${newState}`);
                    updateActiveButton();
                };
                
                // Start with idle
                animationController.playIdle();
                
                // Show success
                statusEl.textContent = `✓ ${targetSlot}: ${newClip.name} (${newClip.duration.toFixed(2)}s)`;
                statusEl.className = 'fbx-status success';
                
                console.log(`[Playground] Loaded custom animation for ${targetSlot}: ${newClip.name}`);
            } else {
                statusEl.textContent = '✗ El archivo no contiene animaciones';
                statusEl.className = 'fbx-status error';
            }
            
            // Cleanup
            URL.revokeObjectURL(url);
            loadedModel.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => m.dispose());
                }
            });
        }, undefined, (error) => {
            statusEl.textContent = `✗ Error: ${error.message}`;
            statusEl.className = 'fbx-status error';
            URL.revokeObjectURL(url);
        });
        
    } catch (error) {
        statusEl.textContent = `✗ Error: ${error.message}`;
        statusEl.className = 'fbx-status error';
    }
    
    // Reset file input so same file can be selected again
    event.target.value = '';
}

function handleKeyDown(e) {
    if (!animationController) return;
    
    const key = e.key.toLowerCase();
    
    switch (key) {
        case 'i':
            playAnimation('idle');
            break;
        case 'w':
            playAnimation('walk');
            break;
        case 'r':
            playAnimation('run');
            break;
        case 'j':
            playAnimation('punch');
            break;
        case 'k':
            playAnimation('kick');
            break;
        case 'h':
            playAnimation('hit');
            break;
        case 'f':
            playAnimation('fall');
            break;
        case 'arrowleft':
            e.preventDefault();
            setMovement('left', true);
            break;
        case 'arrowright':
            e.preventDefault();
            setMovement('right', true);
            break;
        case 'shift':
            movementState.run = true;
            document.getElementById('chk-run').checked = true;
            break;
    }
}

function handleKeyUp(e) {
    const key = e.key.toLowerCase();
    
    switch (key) {
        case 'arrowleft':
            setMovement('left', false);
            break;
        case 'arrowright':
            setMovement('right', false);
            break;
        case 'shift':
            movementState.run = false;
            document.getElementById('chk-run').checked = false;
            break;
    }
}

function setMovement(direction, active) {
    movementState[direction] = active;
    
    // Update button states
    document.getElementById('btn-left').classList.toggle('active', movementState.left);
    document.getElementById('btn-right').classList.toggle('active', movementState.right);
}

function playAnimation(name) {
    if (!animationController) return;
    
    switch (name) {
        case 'idle':
            animationController.playIdle();
            break;
        case 'walk':
            animationController.playWalk();
            break;
        case 'run':
            animationController.playRun();
            break;
        case 'punch':
            animationController.playPunch();
            break;
        case 'kick':
            animationController.playKick();
            break;
        case 'hit':
            animationController.playHit();
            break;
        case 'fall':
            animationController.playFall();
            break;
    }
    
    updateActiveButton();
}

function updateActiveButton() {
    if (!animationController) return;
    
    const currentName = animationController.currentActionName;
    
    document.querySelectorAll('.anim-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.animation === currentName);
    });
}

// =================================
// Camera Control
// =================================

function setCameraPosition(position) {
    const pos = CAMERA_POSITIONS[position];
    if (!pos) return;
    
    // Animate camera
    const startPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const startTime = performance.now();
    const duration = 500;
    
    function animateCamera(time) {
        const elapsed = time - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // Ease out cubic
        
        camera.position.x = startPos.x + (pos.x - startPos.x) * eased;
        camera.position.y = startPos.y + (pos.y - startPos.y) * eased;
        camera.position.z = startPos.z + (pos.z - startPos.z) * eased;
        camera.lookAt(0, 1, 0);
        
        if (t < 1) {
            requestAnimationFrame(animateCamera);
        }
    }
    
    requestAnimationFrame(animateCamera);
    
    // Update button states
    document.querySelectorAll('.camera-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `btn-camera-${position}`);
    });
}

// =================================
// UI Updates
// =================================

function updateUI() {
    if (!animationController) return;
    
    const info = animationController.getInfo();
    
    // Update text displays
    currentAnimationEl.textContent = info.name.charAt(0).toUpperCase() + info.name.slice(1);
    animationTimeEl.textContent = `${info.time.toFixed(2)}s`;
    animationDurationEl.textContent = `${info.duration.toFixed(2)}s`;
    
    // Update status
    let statusText = 'Idle';
    let statusClass = 'status-idle';
    
    if (info.isAttacking) {
        statusText = 'Atacando';
        statusClass = 'status-attacking';
    } else if (info.isPlaying && !info.isPaused) {
        statusText = 'Reproduciendo';
        statusClass = 'status-playing';
    }
    
    animationStatusEl.textContent = statusText;
    animationStatusEl.className = `value ${statusClass}`;
    
    // Update progress bar
    const progress = info.duration > 0 ? (info.time / info.duration) * 100 : 0;
    progressBar.style.width = `${progress}%`;
}

// =================================
// Window Resize
// =================================

function onWindowResize() {
    const canvas = document.getElementById('playground-canvas');
    const container = document.getElementById('canvas-container');
    
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// =================================
// Animation Loop
// =================================

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update movement from input
    if (animationController && model) {
        const isMoving = movementState.left || movementState.right;
        const isRunning = movementState.run && isMoving;
        
        // Update animation based on movement
        animationController.updateFromMovementState({
            isMoving,
            isRunning,
            isGrounded: true,
            isJumping: false
        });
        
        // Move model position
        if (isMoving && !animationController.isAttacking) {
            const speed = isRunning ? 4 : 2;
            if (movementState.left) {
                positionX -= speed * delta;
                facingRight = false;
            }
            if (movementState.right) {
                positionX += speed * delta;
                facingRight = true;
            }
            
            // Clamp position
            positionX = Math.max(-5, Math.min(5, positionX));
            model.position.x = positionX;
        }
        
        // Update model facing direction using scale.x flip
        // Positive scale = facing right, negative scale = facing left
        const targetScaleX = facingRight ? 0.01 : -0.01;
        model.scale.x = THREE.MathUtils.lerp(model.scale.x, targetScaleX, 0.15);
        
        // Update animation mixer
        animationController.update(delta);
    }
    
    // Update UI
    updateUI();
    
    // Render
    renderer.render(scene, camera);
}

// =================================
// Start
// =================================

init();

