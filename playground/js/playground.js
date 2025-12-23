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
// Character Models (shared with main game)
// =================================

const CHARACTER_MODELS = {
    edgar: {
        name: 'Edgar',
        file: 'Edgar_Model.fbx',
        thumbnail: '👦'
    },
    isabella: {
        name: 'Isabella', 
        file: 'Isabella_Model.fbx',
        thumbnail: '👧'
    }
};

let selectedCharacter = 'edgar';

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

// Animation Speed Storage Key
const SPEED_STORAGE_KEY = 'pelea-peluches-animation-speeds';

// Default animation speeds
const defaultSpeeds = {
    walk: 1.0,
    run: 1.0,
    punch: 1.0,
    kick: 1.0,
    hit: 1.0,
    fall: 1.0
};

// Current speeds (loaded from storage or defaults)
let animationSpeeds = { ...defaultSpeeds };

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
    
    // Create character selector UI
    createPlaygroundCharacterSelector();
    
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

async function loadCharacter(characterId = null) {
    const loader = new FBXLoader();
    const animationFiles = ANIMATION_CONFIG.files;
    const totalFiles = Object.keys(animationFiles).length + 1; // +1 for character model
    let loadedCount = 0;
    
    // Use provided character or selected one
    const charId = characterId || selectedCharacter;
    const characterConfig = CHARACTER_MODELS[charId];
    
    if (!characterConfig) {
        console.error(`[Playground] Character ${charId} not found!`);
        return;
    }
    
    try {
        // Load selected character model
        loadingText.textContent = `Cargando modelo: ${characterConfig.name}...`;
        model = await loadFBX(loader, `../assets/${characterConfig.file}`);
        // Scale (negative Z to face right by default)
        model.scale.set(0.01, 0.01, -0.01);
        
        // Rotate model 90° to show profile view
        model.rotation.y = -Math.PI / 2;
        
        // Enable shadows and fix transparency
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Fix transparency
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.transparent = false;
                    mat.opacity = 1.0;
                    mat.depthWrite = true;
                    mat.needsUpdate = true;
                });
            }
        });
        
        loadedCount++;
        console.log(`[Playground] Loaded model: ${characterConfig.name}`);
        
        // Load all animations
        for (const [actionName, fileName] of Object.entries(animationFiles)) {
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
        
        // Apply saved animation speeds
        applySavedSpeedsToController();
        
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

/**
 * Change character model in playground
 */
async function changePlaygroundCharacter(characterId) {
    if (!CHARACTER_MODELS[characterId]) {
        console.error(`[Playground] Character ${characterId} not found!`);
        return;
    }
    
    if (selectedCharacter === characterId && model) {
        console.log(`[Playground] Character ${characterId} already loaded`);
        return;
    }
    
    console.log(`[Playground] Changing character to: ${characterId}`);
    selectedCharacter = characterId;
    
    // Show loading
    loadingOverlay.classList.remove('hidden');
    loadingText.textContent = `Cargando ${CHARACTER_MODELS[characterId].name}...`;
    
    // Clean up old model
    if (model) {
        scene.remove(model);
        model.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => m.dispose());
            }
        });
        model = null;
    }
    
    // Clean up animation controller
    if (animationController) {
        animationController.dispose();
        animationController = null;
    }
    
    // Clear animations
    Object.keys(animations).forEach(key => delete animations[key]);
    
    // Reset position
    positionX = 0;
    facingRight = true;
    
    // Load new character
    await loadCharacter(characterId);
    
    // Update UI
    updateCharacterSelector();
}

/**
 * Update character selector buttons
 */
function updateCharacterSelector() {
    document.querySelectorAll('.pg-char-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.character === selectedCharacter);
    });
}

/**
 * Create character selector in playground
 */
function createPlaygroundCharacterSelector() {
    const panel = document.getElementById('control-panel');
    if (!panel) return;
    
    // Find first section or create at start
    const firstSection = panel.querySelector('.panel-section');
    
    const selectorHTML = `
        <section class="panel-section character-section">
            <h2>🎭 Personaje</h2>
            <div class="pg-character-options">
                ${Object.entries(CHARACTER_MODELS).map(([id, char]) => `
                    <button class="pg-char-btn ${id === selectedCharacter ? 'selected' : ''}" 
                            data-character="${id}">
                        <span class="pg-char-thumb">${char.thumbnail}</span>
                        <span class="pg-char-name">${char.name}</span>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
    
    if (firstSection) {
        firstSection.insertAdjacentHTML('beforebegin', selectorHTML);
    } else {
        panel.insertAdjacentHTML('afterbegin', selectorHTML);
    }
    
    // Add click handlers
    document.querySelectorAll('.pg-char-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            changePlaygroundCharacter(btn.dataset.character);
        });
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
    
    // Custom FBX file loader - using label click (no JS needed for click)
    const fbxFileInput = document.getElementById('fbx-file-input');
    fbxFileInput.addEventListener('change', handleFBXUpload);
    
    // Animation Speed Controls
    setupSpeedControls();
    
    // Keyboard controls
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
}

// =================================
// Animation Speed Controls
// =================================

function setupSpeedControls() {
    const speedSelect = document.getElementById('speed-animation-select');
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');
    const btnPreview = document.getElementById('btn-preview-speed');
    const btnSave = document.getElementById('btn-save-speed');
    const btnReset = document.getElementById('btn-reset-speed');
    
    // Load saved speeds from localStorage
    loadSavedSpeeds();
    updateSavedSpeedsList();
    
    // Update slider when animation selection changes
    speedSelect.addEventListener('change', () => {
        const animName = speedSelect.value;
        const currentSpeed = animationSpeeds[animName] || 1.0;
        speedSlider.value = currentSpeed;
        speedValue.textContent = `${currentSpeed.toFixed(1)}x`;
    });
    
    // Update display when slider changes
    speedSlider.addEventListener('input', () => {
        const speed = parseFloat(speedSlider.value);
        speedValue.textContent = `${speed.toFixed(1)}x`;
    });
    
    // Preview button - play the animation with current slider speed
    btnPreview.addEventListener('click', () => {
        const animName = speedSelect.value;
        const speed = parseFloat(speedSlider.value);
        
        // Temporarily set the speed and play the animation
        if (animationController) {
            animationController.setAnimationSpeed(animName, speed);
            playAnimation(animName);
        }
    });
    
    // Save button - save the speed to localStorage
    btnSave.addEventListener('click', () => {
        const animName = speedSelect.value;
        const speed = parseFloat(speedSlider.value);
        
        // Update speeds object
        animationSpeeds[animName] = speed;
        
        // Save to localStorage
        saveSpeeds();
        
        // Update the animation controller permanently
        if (animationController) {
            animationController.setAnimationSpeed(animName, speed);
        }
        
        // Update display
        updateSavedSpeedsList();
        
        // Show confirmation
        showSpeedSavedFeedback(animName, speed);
    });
    
    // Reset button - reset current animation to default speed
    btnReset.addEventListener('click', () => {
        const animName = speedSelect.value;
        const defaultSpeed = defaultSpeeds[animName] || 1.0;
        
        // Reset speed
        animationSpeeds[animName] = defaultSpeed;
        speedSlider.value = defaultSpeed;
        speedValue.textContent = `${defaultSpeed.toFixed(1)}x`;
        
        // Update animation controller
        if (animationController) {
            animationController.setAnimationSpeed(animName, defaultSpeed);
        }
        
        // Save to localStorage
        saveSpeeds();
        updateSavedSpeedsList();
    });
}

function loadSavedSpeeds() {
    try {
        const saved = localStorage.getItem(SPEED_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            animationSpeeds = { ...defaultSpeeds, ...parsed };
            console.log('[Playground] Loaded animation speeds:', animationSpeeds);
        }
    } catch (e) {
        console.warn('[Playground] Failed to load saved speeds:', e);
        animationSpeeds = { ...defaultSpeeds };
    }
}

function saveSpeeds() {
    try {
        localStorage.setItem(SPEED_STORAGE_KEY, JSON.stringify(animationSpeeds));
        console.log('[Playground] Saved animation speeds:', animationSpeeds);
    } catch (e) {
        console.warn('[Playground] Failed to save speeds:', e);
    }
}

function updateSavedSpeedsList() {
    const listEl = document.getElementById('saved-speeds-list');
    if (!listEl) return;
    
    listEl.innerHTML = '';
    
    for (const [name, speed] of Object.entries(animationSpeeds)) {
        const isDefault = speed === (defaultSpeeds[name] || 1.0);
        if (!isDefault) {
            const tag = document.createElement('span');
            tag.className = 'saved-speed-tag';
            tag.innerHTML = `<span class="name">${name}:</span> <span class="value">${speed.toFixed(1)}x</span>`;
            listEl.appendChild(tag);
        }
    }
    
    if (listEl.children.length === 0) {
        listEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.75rem;">Todas en velocidad normal (1.0x)</span>';
    }
}

function showSpeedSavedFeedback(animName, speed) {
    const btnSave = document.getElementById('btn-save-speed');
    const originalText = btnSave.textContent;
    btnSave.textContent = `✓ ${animName}: ${speed.toFixed(1)}x`;
    btnSave.style.background = 'rgba(0, 255, 204, 0.3)';
    
    setTimeout(() => {
        btnSave.textContent = originalText;
        btnSave.style.background = '';
    }, 1500);
}

/**
 * Apply saved animation speeds to the animation controller
 */
function applySavedSpeedsToController() {
    if (!animationController) return;
    
    for (const [name, speed] of Object.entries(animationSpeeds)) {
        if (speed !== 1.0) {
            animationController.setAnimationSpeed(name, speed);
        }
    }
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
        case 'l':
            playAnimation('block');
            break;
        case 't':
            playAnimation('taunt');
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
        
        // Update model facing direction using scale.z flip
        // After -90° rotation, scale.z controls left/right facing
        // Negative = facing right, positive = facing left
        const targetScaleZ = facingRight ? -0.01 : 0.01;
        model.scale.z = THREE.MathUtils.lerp(model.scale.z, targetScaleZ, 0.15);
        
        // IDLE ROTATION: When idle, rotate character slightly toward camera to show face
        // When moving, return to profile view for proper walk/run animation
        const isIdle = !isMoving && 
                       !animationController.isAttacking && 
                       !animationController.isBlocking && 
                       !animationController.isTaunting;
        
        // With negative scale.z flip, rotating MORE negative shows the face
        // -PI/2 (-90°) = profile view (for walking)
        // -PI*0.65 (-117°) = 3/4 view showing more face (for idle)
        const profileRotation = -Math.PI / 2;      // -90° full profile for walking
        const idleRotation = -Math.PI * 0.65;      // -117° 3/4 view showing face
        const targetRotation = isIdle ? idleRotation : profileRotation;
        
        // Smooth interpolation for rotation
        model.rotation.y = THREE.MathUtils.lerp(
            model.rotation.y, 
            targetRotation, 
            0.08 // Slower lerp for smoother rotation
        );
        
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

