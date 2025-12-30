/**
 * VFXManager - Centralized Visual Effects System
 * Manages all particle effects, sprites, and visual feedback for the game
 */
class VFXManager {
    constructor(scene, camera, threeLib = null) {
        this.scene = scene;
        this.camera = camera;
        this.activeEffects = [];
        this.particlePools = {};
        
        // Use provided THREE library or get from window (for ES modules compatibility)
        this.THREE = threeLib || window.THREE;
        
        if (!this.THREE) {
            console.error('[VFXManager] THREE.js not found! Effects will be disabled.');
            return;
        }
        
        // Reusable geometries and materials
        this.sparkGeometry = null;
        this.dustGeometry = null;
        
        // DOM container for floating numbers
        this.domContainer = document.getElementById('game-container') || document.body;
        
        // Initialize reusable resources
        this._initResources();
    }
    
    /**
     * Initialize reusable geometries and materials
     */
    _initResources() {
        // Create spark texture programmatically
        this.sparkTexture = this._createSparkTexture();
        this.starTexture = this._createStarTexture();
        this.ringTexture = this._createRingTexture();
        this.shieldTexture = this._createShieldTexture();
    }
    
    /**
     * Create a spark/glow texture
     */
    _createSparkTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.8)');
        gradient.addColorStop(0.6, 'rgba(255, 200, 100, 0.4)');
        gradient.addColorStop(1, 'rgba(255, 100, 50, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        
        const texture = new this.THREE.CanvasTexture(canvas);
        return texture;
    }
    
    /**
     * Create a star shape texture
     */
    _createStarTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        ctx.translate(32, 32);
        ctx.fillStyle = '#FFFFFF';
        
        // Draw 4-point star
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI / 2) - Math.PI / 2;
            const outerX = Math.cos(angle) * 28;
            const outerY = Math.sin(angle) * 28;
            const innerAngle = angle + Math.PI / 4;
            const innerX = Math.cos(innerAngle) * 10;
            const innerY = Math.sin(innerAngle) * 10;
            
            if (i === 0) {
                ctx.moveTo(outerX, outerY);
            } else {
                ctx.lineTo(outerX, outerY);
            }
            ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();
        
        // Add glow
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 10;
        ctx.fill();
        
        const texture = new this.THREE.CanvasTexture(canvas);
        return texture;
    }
    
    /**
     * Create a ring texture for impact rings
     */
    _createRingTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.stroke();
        
        // Inner glow
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.stroke();
        
        const texture = new this.THREE.CanvasTexture(canvas);
        return texture;
    }
    
    /**
     * Create a shield texture for block effects
     */
    _createShieldTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Hexagonal shield pattern
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(100, 200, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(50, 150, 255, 0.5)');
        gradient.addColorStop(0.8, 'rgba(0, 100, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 50, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI / 3) - Math.PI / 2;
            const x = 64 + Math.cos(angle) * 55;
            const y = 64 + Math.sin(angle) * 55;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        
        // Add border
        ctx.strokeStyle = 'rgba(150, 220, 255, 0.9)';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        const texture = new this.THREE.CanvasTexture(canvas);
        return texture;
    }

    // ==========================================
    // HIT IMPACT EFFECTS
    // ==========================================
    
    /**
     * Create spark particles at hit location
     * @param {THREE.Vector3} position - World position of impact
     * @param {number|string} color - Color of sparks (hex or string)
     * @param {number} intensity - Effect intensity (0.5 - 2.0)
     */
    createHitSparks(position, color = 0xFF6600, intensity = 1.0) {
        const particleCount = Math.floor(20 * intensity);
        const baseColor = new this.THREE.Color(color);
        
        // Create particles
        const geometry = new this.THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;
            
            // Color variation
            const colorVar = baseColor.clone();
            colorVar.offsetHSL(0, 0, Math.random() * 0.3);
            colors[i * 3] = colorVar.r;
            colors[i * 3 + 1] = colorVar.g;
            colors[i * 3 + 2] = colorVar.b;
            
            sizes[i] = (0.1 + Math.random() * 0.2) * intensity;
            
            // Random velocity
            velocities.push({
                x: (Math.random() - 0.5) * 15 * intensity,
                y: Math.random() * 10 * intensity,
                z: (Math.random() - 0.5) * 5
            });
        }
        
        geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new this.THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new this.THREE.BufferAttribute(sizes, 1));
        
        const material = new this.THREE.PointsMaterial({
            size: 0.3,
            map: this.sparkTexture,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });
        
        const particles = new this.THREE.Points(geometry, material);
        this.scene.add(particles);
        
        // Animation
        const effect = {
            type: 'hitSparks',
            object: particles,
            velocities: velocities,
            startTime: performance.now(),
            duration: 400,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                const positions = particles.geometry.attributes.position.array;
                const gravity = 25;
                
                for (let i = 0; i < particleCount; i++) {
                    const v = velocities[i];
                    positions[i * 3] += v.x * 0.016;
                    positions[i * 3 + 1] += (v.y - gravity * progress) * 0.016;
                    positions[i * 3 + 2] += v.z * 0.016;
                    v.y -= gravity * 0.016;
                }
                
                particles.geometry.attributes.position.needsUpdate = true;
                material.opacity = 1 - progress;
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Create expanding ring effect at impact point
     * @param {THREE.Vector3} position - World position
     * @param {number|string} color - Ring color
     */
    createImpactRing(position, color = 0xFF6600) {
        const ringGeometry = new this.THREE.RingGeometry(0.1, 0.3, 32);
        const ringMaterial = new this.THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            side: this.THREE.DoubleSide,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const ring = new this.THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.copy(position);
        ring.rotation.x = -Math.PI / 2; // Face camera
        ring.lookAt(this.camera.position);
        this.scene.add(ring);
        
        const effect = {
            type: 'impactRing',
            object: ring,
            startTime: performance.now(),
            duration: 300,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                const scale = 1 + progress * 5;
                ring.scale.set(scale, scale, scale);
                ringMaterial.opacity = 0.8 * (1 - progress);
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Flash the character model white on hit
     * @param {THREE.Object3D} model - The character model
     * @param {number} duration - Flash duration in ms
     */
    createCharacterFlash(model, duration = 100) {
        if (!model) return;
        
        const originalMaterials = [];
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                originalMaterials.push({
                    mesh: child,
                    emissive: child.material.emissive ? child.material.emissive.clone() : null,
                    emissiveIntensity: child.material.emissiveIntensity || 0
                });
                
                if (child.material.emissive) {
                    child.material.emissive.setHex(0xFFFFFF);
                    child.material.emissiveIntensity = 0.5;
                }
            }
        });
        
        setTimeout(() => {
            originalMaterials.forEach(({ mesh, emissive, emissiveIntensity }) => {
                if (mesh.material.emissive && emissive) {
                    mesh.material.emissive.copy(emissive);
                    mesh.material.emissiveIntensity = emissiveIntensity;
                }
            });
        }, duration);
    }

    // ==========================================
    // DAMAGE NUMBERS
    // ==========================================
    
    /**
     * Create floating damage number
     * @param {THREE.Vector3} position - World position
     * @param {number} damage - Damage amount to display
     * @param {number|string} color - Text color
     */
    createDamageNumber(position, damage, color = '#FF6600') {
        const screenPos = this._worldToScreen(position);
        
        const element = document.createElement('div');
        element.className = 'vfx-damage-number';
        element.textContent = `${Math.round(damage)}%`;
        element.style.cssText = `
            position: fixed;
            left: ${screenPos.x}px;
            top: ${screenPos.y}px;
            font-family: 'Impact', 'Arial Black', sans-serif;
            font-size: 32px;
            font-weight: bold;
            color: ${typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color};
            text-shadow: 
                -2px -2px 0 #000,
                2px -2px 0 #000,
                -2px 2px 0 #000,
                2px 2px 0 #000,
                0 0 10px rgba(255, 200, 0, 0.8);
            pointer-events: none;
            z-index: 1000;
            transform: translate(-50%, -50%) scale(0.5);
            transition: none;
        `;
        
        this.domContainer.appendChild(element);
        
        // Animate with CSS
        requestAnimationFrame(() => {
            element.style.transition = 'all 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)';
            element.style.transform = 'translate(-50%, -150%) scale(1.2)';
            element.style.opacity = '0';
        });
        
        // Remove after animation
        setTimeout(() => {
            element.remove();
        }, 700);
    }
    
    /**
     * Convert world position to screen coordinates
     */
    _worldToScreen(position) {
        const vector = position.clone();
        vector.project(this.camera);
        
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;
        
        return {
            x: (vector.x * widthHalf) + widthHalf,
            y: -(vector.y * heightHalf) + heightHalf
        };
    }

    // ==========================================
    // BLOCK EFFECTS
    // ==========================================
    
    /**
     * Create shield effect when blocking
     * @param {THREE.Vector3} position - Position of blocking player
     * @param {string|number} color - Shield color
     */
    createBlockShield(position, color = 0x00BFFF) {
        // Create hexagonal shield sprite
        const spriteMaterial = new this.THREE.SpriteMaterial({
            map: this.shieldTexture,
            color: color,
            transparent: true,
            opacity: 0.9,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const shield = new this.THREE.Sprite(spriteMaterial);
        shield.position.copy(position);
        shield.position.z += 0.5;
        shield.scale.set(0.1, 0.1, 1);
        this.scene.add(shield);
        
        const effect = {
            type: 'blockShield',
            object: shield,
            startTime: performance.now(),
            duration: 250,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                
                // Pop-in then fade
                let scale, opacity;
                if (progress < 0.3) {
                    scale = this.THREE.MathUtils.lerp(0.1, 2.5, progress / 0.3);
                    opacity = 0.9;
                } else {
                    scale = 2.5;
                    opacity = 0.9 * (1 - (progress - 0.3) / 0.7);
                }
                
                shield.scale.set(scale, scale, 1);
                spriteMaterial.opacity = opacity;
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Create sparks bouncing off shield
     * @param {THREE.Vector3} position - Position of block
     */
    createBlockSparks(position) {
        const particleCount = 15;
        const geometry = new this.THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const velocities = [];
        
        const blueColor = new this.THREE.Color(0x00BFFF);
        const whiteColor = new this.THREE.Color(0xFFFFFF);
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z + 0.5;
            
            const color = blueColor.clone().lerp(whiteColor, Math.random() * 0.5);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            
            // Sparks fly outward from block point
            velocities.push({
                x: (Math.random() - 0.5) * 12,
                y: Math.random() * 8 + 2,
                z: Math.random() * 3 + 1
            });
        }
        
        geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new this.THREE.BufferAttribute(colors, 3));
        
        const material = new this.THREE.PointsMaterial({
            size: 0.2,
            map: this.starTexture,
            vertexColors: true,
            transparent: true,
            opacity: 1,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const particles = new this.THREE.Points(geometry, material);
        this.scene.add(particles);
        
        const effect = {
            type: 'blockSparks',
            object: particles,
            velocities: velocities,
            startTime: performance.now(),
            duration: 350,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                const positions = particles.geometry.attributes.position.array;
                
                for (let i = 0; i < particleCount; i++) {
                    const v = velocities[i];
                    positions[i * 3] += v.x * 0.016;
                    positions[i * 3 + 1] += v.y * 0.016;
                    positions[i * 3 + 2] += v.z * 0.016;
                    v.y -= 15 * 0.016; // gravity
                }
                
                particles.geometry.attributes.position.needsUpdate = true;
                material.opacity = 1 - progress;
            }
        };
        
        this.activeEffects.push(effect);
    }

    // ==========================================
    // MOVEMENT EFFECTS
    // ==========================================
    
    /**
     * Create dust cloud when running
     * @param {THREE.Vector3} position - Foot position
     * @param {number} direction - Movement direction (-1 left, 1 right)
     */
    createDustCloud(position, direction = 1) {
        const particleCount = 8;
        const geometry = new this.THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x + (Math.random() - 0.5) * 0.3;
            positions[i * 3 + 1] = position.y + Math.random() * 0.2;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.3;
            
            velocities.push({
                x: -direction * (Math.random() * 2 + 1),
                y: Math.random() * 2 + 0.5,
                z: (Math.random() - 0.5) * 1
            });
        }
        
        geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
        
        const material = new this.THREE.PointsMaterial({
            size: 0.25,
            color: 0xAAAAAA,
            transparent: true,
            opacity: 0.6,
            depthWrite: false
        });
        
        const particles = new this.THREE.Points(geometry, material);
        this.scene.add(particles);
        
        const effect = {
            type: 'dustCloud',
            object: particles,
            velocities: velocities,
            startTime: performance.now(),
            duration: 300,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                const positions = particles.geometry.attributes.position.array;
                
                for (let i = 0; i < particleCount; i++) {
                    const v = velocities[i];
                    positions[i * 3] += v.x * 0.016;
                    positions[i * 3 + 1] += v.y * 0.016;
                    positions[i * 3 + 2] += v.z * 0.016;
                    v.y -= 3 * 0.016;
                }
                
                particles.geometry.attributes.position.needsUpdate = true;
                material.opacity = 0.6 * (1 - progress);
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Create impact effect when landing
     * @param {THREE.Vector3} position - Landing position
     * @param {number} intensity - Impact strength (based on fall height)
     */
    createLandingImpact(position, intensity = 1.0) {
        const particleCount = Math.floor(12 * intensity);
        const geometry = new this.THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;
            
            velocities.push({
                x: Math.cos(angle) * (3 + Math.random() * 2) * intensity,
                y: Math.random() * 2 * intensity,
                z: Math.sin(angle) * (1 + Math.random())
            });
        }
        
        geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
        
        const material = new this.THREE.PointsMaterial({
            size: 0.2,
            color: 0xBBBBBB,
            transparent: true,
            opacity: 0.7,
            depthWrite: false
        });
        
        const particles = new this.THREE.Points(geometry, material);
        this.scene.add(particles);
        
        // Also create ground ring
        const ringGeometry = new this.THREE.RingGeometry(0.1, 0.2, 16);
        const ringMaterial = new this.THREE.MeshBasicMaterial({
            color: 0xAAAAAA,
            transparent: true,
            opacity: 0.5,
            side: this.THREE.DoubleSide,
            depthWrite: false
        });
        
        const ring = new this.THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.copy(position);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        
        const effect = {
            type: 'landingImpact',
            object: particles,
            ring: ring,
            velocities: velocities,
            startTime: performance.now(),
            duration: 400,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                const positions = particles.geometry.attributes.position.array;
                
                for (let i = 0; i < particleCount; i++) {
                    const v = velocities[i];
                    positions[i * 3] += v.x * 0.016;
                    positions[i * 3 + 1] += v.y * 0.016;
                    positions[i * 3 + 2] += v.z * 0.016;
                    v.y -= 8 * 0.016;
                }
                
                particles.geometry.attributes.position.needsUpdate = true;
                material.opacity = 0.7 * (1 - progress);
                
                // Expand ring
                const ringScale = 1 + progress * 3;
                ring.scale.set(ringScale, ringScale, 1);
                ringMaterial.opacity = 0.5 * (1 - progress);
            },
            cleanup: () => {
                this.scene.remove(ring);
                ringGeometry.dispose();
                ringMaterial.dispose();
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Create jump trail effect
     * @param {THREE.Vector3} position - Current position
     * @param {number|string} color - Trail color
     */
    createJumpTrail(position, color = 0xFFFFFF) {
        const spriteMaterial = new this.THREE.SpriteMaterial({
            color: color,
            transparent: true,
            opacity: 0.4,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const sprite = new this.THREE.Sprite(spriteMaterial);
        sprite.position.copy(position);
        sprite.scale.set(0.8, 1.2, 1);
        this.scene.add(sprite);
        
        const effect = {
            type: 'jumpTrail',
            object: sprite,
            startTime: performance.now(),
            duration: 200,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                spriteMaterial.opacity = 0.4 * (1 - progress);
                sprite.scale.y = 1.2 + progress * 0.5;
            }
        };
        
        this.activeEffects.push(effect);
    }

    // ==========================================
    // ATTACK EFFECTS
    // ==========================================
    
    /**
     * Create attack trail effect
     * @param {THREE.Vector3} position - Attack position
     * @param {string} attackType - 'punch' or 'kick'
     * @param {number} direction - Facing direction (-1 left, 1 right)
     * @param {number|string} color - Trail color
     */
    createAttackTrail(position, attackType = 'punch', direction = 1, color = 0xFF6600) {
        // Create arc/slash effect
        const curve = new this.THREE.QuadraticBezierCurve3(
            new this.THREE.Vector3(position.x - direction * 0.5, position.y + 0.5, position.z),
            new this.THREE.Vector3(position.x + direction * 0.8, position.y + 0.8, position.z + 0.3),
            new this.THREE.Vector3(position.x + direction * 1.2, position.y + 0.3, position.z)
        );
        
        if (attackType === 'kick') {
            // Lower arc for kicks
            curve.v0.set(position.x, position.y - 0.2, position.z);
            curve.v1.set(position.x + direction * 0.8, position.y, position.z + 0.3);
            curve.v2.set(position.x + direction * 1.2, position.y + 0.5, position.z);
        }
        
        const points = curve.getPoints(20);
        const geometry = new this.THREE.BufferGeometry().setFromPoints(points);
        
        const material = new this.THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            linewidth: 3,
            blending: this.THREE.AdditiveBlending
        });
        
        const trail = new this.THREE.Line(geometry, material);
        this.scene.add(trail);
        
        const effect = {
            type: 'attackTrail',
            object: trail,
            startTime: performance.now(),
            duration: 200,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                material.opacity = 0.8 * (1 - progress);
            }
        };
        
        this.activeEffects.push(effect);
    }
    
    /**
     * Create glow effect around character during attack
     * @param {THREE.Object3D} model - Character model
     * @param {number|string} color - Glow color
     */
    createChargeGlow(model, color = 0xFF6600) {
        if (!model) return;
        
        const position = new this.THREE.Vector3();
        model.getWorldPosition(position);
        
        const spriteMaterial = new this.THREE.SpriteMaterial({
            color: color,
            transparent: true,
            opacity: 0.3,
            blending: this.THREE.AdditiveBlending,
            depthWrite: false
        });
        
        const glow = new this.THREE.Sprite(spriteMaterial);
        glow.position.copy(position);
        glow.scale.set(3, 3, 1);
        this.scene.add(glow);
        
        const effect = {
            type: 'chargeGlow',
            object: glow,
            model: model,
            startTime: performance.now(),
            duration: 150,
            update: (elapsed) => {
                const progress = elapsed / effect.duration;
                
                // Follow model
                model.getWorldPosition(glow.position);
                
                // Pulse effect
                const pulse = Math.sin(progress * Math.PI);
                glow.scale.setScalar(3 + pulse * 0.5);
                spriteMaterial.opacity = 0.3 * (1 - progress * 0.5);
            }
        };
        
        this.activeEffects.push(effect);
    }

    // ==========================================
    // UTILITY METHODS
    // ==========================================
    
    /**
     * Update all active effects - call this in the animation loop
     * @param {number} deltaTime - Time since last frame
     */
    update(deltaTime) {
        const now = performance.now();
        
        for (let i = this.activeEffects.length - 1; i >= 0; i--) {
            const effect = this.activeEffects[i];
            const elapsed = now - effect.startTime;
            
            if (elapsed >= effect.duration) {
                // Effect complete - cleanup
                if (effect.object) {
                    this.scene.remove(effect.object);
                    if (effect.object.geometry) effect.object.geometry.dispose();
                    if (effect.object.material) {
                        if (Array.isArray(effect.object.material)) {
                            effect.object.material.forEach(m => m.dispose());
                        } else {
                            effect.object.material.dispose();
                        }
                    }
                }
                if (effect.cleanup) {
                    effect.cleanup();
                }
                this.activeEffects.splice(i, 1);
            } else {
                // Update effect
                effect.update(elapsed);
            }
        }
    }
    
    /**
     * Dispose of all resources
     */
    dispose() {
        // Remove all active effects
        this.activeEffects.forEach(effect => {
            if (effect.object) {
                this.scene.remove(effect.object);
                if (effect.object.geometry) effect.object.geometry.dispose();
                if (effect.object.material) {
                    if (Array.isArray(effect.object.material)) {
                        effect.object.material.forEach(m => m.dispose());
                    } else {
                        effect.object.material.dispose();
                    }
                }
            }
            if (effect.cleanup) {
                effect.cleanup();
            }
        });
        this.activeEffects = [];
        
        // Dispose textures
        if (this.sparkTexture) this.sparkTexture.dispose();
        if (this.starTexture) this.starTexture.dispose();
        if (this.ringTexture) this.ringTexture.dispose();
        if (this.shieldTexture) this.shieldTexture.dispose();
    }
}

export default VFXManager;

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VFXManager;
}

// Expose to global scope for dynamic loading
if (typeof window !== 'undefined') {
    window.VFXManager = VFXManager;
}

