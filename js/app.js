// Arc Raiders Quest Graph Viewer
// Professional Obsidian-style graph visualization

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════
    
    const CONFIG = {
        nodeRadius: 8,
        nodeSpacingX: 160,
        nodeSpacingY: 80,
        traderColors: {
            'Shani': '#39c5cf',
            'Celeste': '#a371f7',
            'Apollo': '#db6d28',
            'Tian Wen': '#3fb950',
            'Lance': '#f85149',
            '': '#d29922'
        }
    };

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    
    let data = null;
    let questMap = new Map();
    let nodePositions = new Map();
    let selectedId = null;
    
    let transform = { x: 0, y: 0, k: 1 };
    let drag = { active: false, startX: 0, startY: 0 };

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════
    
    async function init() {
        try {
            const res = await fetch('data/quests.json');
            data = await res.json();
            
            data.quests.forEach(q => questMap.set(q.id, q));
            
            setupFilters();
            setupSidebar();
            setupGraph();
            setupControls();
            setupLegend();
            updateStats();
            
            requestAnimationFrame(() => fitToView());
        } catch (err) {
            console.error('Failed to load data:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // FILTERS
    // ═══════════════════════════════════════════════════════════════
    
    function setupFilters() {
        const regionSel = document.getElementById('regionFilter');
        const traderSel = document.getElementById('traderFilter');
        
        const regions = [...new Set(data.quests.map(q => q.group))];
        regions.forEach(r => {
            regionSel.add(new Option(r, r));
        });
        
        const traders = [...new Set(data.quests.map(q => q.trader).filter(Boolean))];
        traders.forEach(t => {
            traderSel.add(new Option(t, t));
        });
        
        regionSel.addEventListener('change', applyFilters);
        traderSel.addEventListener('change', applyFilters);
        document.getElementById('search').addEventListener('input', debounce(applyFilters, 200));
        document.getElementById('resetBtn').addEventListener('click', resetFilters);
    }
    
    function applyFilters() {
        const region = document.getElementById('regionFilter').value;
        const trader = document.getElementById('traderFilter').value;
        const search = document.getElementById('search').value.toLowerCase().trim();
        
        const visible = new Set();
        
        data.quests.forEach(q => {
            const matchRegion = region === 'all' || q.group === region;
            const matchTrader = trader === 'all' || q.trader === trader;
            const matchSearch = !search || 
                q.name.toLowerCase().includes(search) ||
                q.objectives.some(o => o.toLowerCase().includes(search)) ||
                q.rewards.some(r => r.name.toLowerCase().includes(search));
            
            if (matchRegion && matchTrader && matchSearch) {
                visible.add(q.id);
            }
        });
        
        updateSidebarVisibility(visible);
        updateGraphVisibility(visible);
    }
    
    function resetFilters() {
        document.getElementById('regionFilter').value = 'all';
        document.getElementById('traderFilter').value = 'all';
        document.getElementById('search').value = '';
        applyFilters();
        fitToView();
    }
    
    function updateGraphVisibility(visible) {
        document.querySelectorAll('.node').forEach(node => {
            node.classList.toggle('dimmed', !visible.has(node.dataset.id));
        });
        
        document.querySelectorAll('.link').forEach(link => {
            const show = visible.has(link.dataset.from) && visible.has(link.dataset.to);
            link.classList.toggle('dimmed', !show);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // SIDEBAR
    // ═══════════════════════════════════════════════════════════════
    
    function setupSidebar() {
        const list = document.getElementById('questList');
        const grouped = groupBy(data.quests, 'group');
        
        Object.entries(grouped).forEach(([group, quests]) => {
            const div = document.createElement('div');
            div.className = 'group';
            div.innerHTML = `
                <div class="group-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                    <span>${group}</span>
                    <span class="count">${quests.length}</span>
                </div>
                <div class="group-items"></div>
            `;
            
            const header = div.querySelector('.group-header');
            const items = div.querySelector('.group-items');
            
            header.addEventListener('click', () => div.classList.toggle('collapsed'));
            
            quests.forEach(q => {
                const item = document.createElement('div');
                item.className = `quest${q.unlockMilestone ? ' milestone' : ''}`;
                item.dataset.id = q.id;
                
                const color = CONFIG.traderColors[q.trader] || CONFIG.traderColors[''];
                item.innerHTML = `
                    <span class="dot" style="background: ${color}"></span>
                    <span class="name">${q.name}</span>
                `;
                
                item.addEventListener('click', () => selectQuest(q.id));
                items.appendChild(item);
            });
            
            list.appendChild(div);
        });
        
        document.getElementById('closeSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('collapsed');
        });
        
        document.getElementById('openSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('collapsed');
        });
    }
    
    function updateSidebarVisibility(visible) {
        document.querySelectorAll('.quest').forEach(item => {
            item.style.display = visible.has(item.dataset.id) ? '' : 'none';
        });
        
        document.querySelectorAll('.group').forEach(group => {
            const hasVisible = group.querySelectorAll('.quest[style=""]').length > 0 ||
                              group.querySelectorAll('.quest:not([style])').length > 0;
            group.style.display = hasVisible ? '' : 'none';
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // GRAPH LAYOUT - TOP TO BOTTOM TREE
    // ═══════════════════════════════════════════════════════════════
    
    function calculateLayout() {
        nodePositions.clear();
        
        // Build adjacency for topological levels
        const levels = new Map();
        const processed = new Set();
        
        // Find all roots (milestones with no prereqs)
        const roots = data.quests.filter(q => q.unlockMilestone && q.prerequisites.length === 0);
        
        function assignLevel(quest, level) {
            if (processed.has(quest.id)) {
                const existing = levels.get(quest.id);
                if (existing !== undefined && existing >= level) return;
            }
            
            levels.set(quest.id, level);
            processed.add(quest.id);
            
            // Find children
            const children = data.quests.filter(q => q.prerequisites.includes(quest.id));
            children.forEach(child => {
                // Only assign if all prereqs have levels
                const prereqLevels = child.prerequisites.map(p => levels.get(p)).filter(l => l !== undefined);
                if (prereqLevels.length === child.prerequisites.length) {
                    const maxPrereq = Math.max(...prereqLevels);
                    assignLevel(child, maxPrereq + 1);
                }
            });
        }
        
        // Process from roots
        roots.forEach(root => assignLevel(root, 0));
        
        // Handle any unprocessed (circular or disconnected)
        let maxAttempts = 10;
        while (processed.size < data.quests.length && maxAttempts-- > 0) {
            data.quests.forEach(q => {
                if (!processed.has(q.id)) {
                    const prereqLevels = q.prerequisites.map(p => levels.get(p)).filter(l => l !== undefined);
                    if (prereqLevels.length > 0 || q.prerequisites.length === 0) {
                        const level = prereqLevels.length > 0 ? Math.max(...prereqLevels) + 1 : 0;
                        assignLevel(q, level);
                    }
                }
            });
        }
        
        // Group by level
        const levelGroups = new Map();
        levels.forEach((level, id) => {
            if (!levelGroups.has(level)) levelGroups.set(level, []);
            levelGroups.get(level).push(id);
        });
        
        // Calculate positions - TOP TO BOTTOM layout
        const maxLevel = Math.max(...levelGroups.keys());
        
        levelGroups.forEach((ids, level) => {
            const count = ids.length;
            const totalWidth = (count - 1) * CONFIG.nodeSpacingX;
            const startX = -totalWidth / 2;
            
            ids.forEach((id, i) => {
                nodePositions.set(id, {
                    x: startX + i * CONFIG.nodeSpacingX,
                    y: level * CONFIG.nodeSpacingY
                });
            });
        });
        
        return { maxLevel, levelGroups };
    }

    // ═══════════════════════════════════════════════════════════════
    // GRAPH RENDERING
    // ═══════════════════════════════════════════════════════════════
    
    function setupGraph() {
        const svg = document.getElementById('graphSvg');
        const group = document.getElementById('graphGroup');
        const linksG = document.getElementById('links');
        const nodesG = document.getElementById('nodes');
        
        calculateLayout();
        
        // Render links
        data.quests.forEach(quest => {
            quest.prerequisites.forEach(prereqId => {
                const from = nodePositions.get(prereqId);
                const to = nodePositions.get(quest.id);
                if (!from || !to) return;
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('class', 'link');
                path.setAttribute('d', createCurvedPath(from, to));
                path.dataset.from = prereqId;
                path.dataset.to = quest.id;
                linksG.appendChild(path);
            });
        });
        
        // Render nodes
        data.quests.forEach(quest => {
            const pos = nodePositions.get(quest.id);
            if (!pos) return;
            
            const color = CONFIG.traderColors[quest.trader] || CONFIG.traderColors[''];
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'node');
            g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
            g.dataset.id = quest.id;
            
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', quest.unlockMilestone ? 10 : CONFIG.nodeRadius);
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', color);
            
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('y', quest.unlockMilestone ? 24 : 20);
            text.textContent = truncate(quest.name, 18);
            
            g.appendChild(circle);
            g.appendChild(text);
            
            g.addEventListener('click', () => selectQuest(quest.id));
            g.addEventListener('mouseenter', () => highlightPath(quest.id));
            g.addEventListener('mouseleave', () => {
                if (!selectedId) clearHighlight();
            });
            
            nodesG.appendChild(g);
        });
        
        // Pan & Zoom
        setupPanZoom(svg, group);
    }
    
    function createCurvedPath(from, to) {
        const midY = (from.y + to.y) / 2;
        return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
    }
    
    function setupPanZoom(svg, group) {
        svg.addEventListener('wheel', e => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newK = Math.max(0.1, Math.min(4, transform.k * delta));
            
            transform.x = mx - (mx - transform.x) * (newK / transform.k);
            transform.y = my - (my - transform.y) * (newK / transform.k);
            transform.k = newK;
            
            applyTransform(group);
        });
        
        svg.addEventListener('mousedown', e => {
            if (e.target.closest('.node')) return;
            drag.active = true;
            drag.startX = e.clientX - transform.x;
            drag.startY = e.clientY - transform.y;
            svg.style.cursor = 'grabbing';
        });
        
        window.addEventListener('mousemove', e => {
            if (!drag.active) return;
            transform.x = e.clientX - drag.startX;
            transform.y = e.clientY - drag.startY;
            applyTransform(group);
        });
        
        window.addEventListener('mouseup', () => {
            drag.active = false;
            svg.style.cursor = 'grab';
        });
        
        // Touch support
        let lastDist = 0;
        svg.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                drag.active = true;
                drag.startX = e.touches[0].clientX - transform.x;
                drag.startY = e.touches[0].clientY - transform.y;
            } else if (e.touches.length === 2) {
                lastDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        });
        
        svg.addEventListener('touchmove', e => {
            e.preventDefault();
            if (e.touches.length === 1 && drag.active) {
                transform.x = e.touches[0].clientX - drag.startX;
                transform.y = e.touches[0].clientY - drag.startY;
                applyTransform(group);
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                transform.k = Math.max(0.1, Math.min(4, transform.k * (dist / lastDist)));
                lastDist = dist;
                applyTransform(group);
            }
        });
        
        svg.addEventListener('touchend', () => drag.active = false);
    }
    
    function applyTransform(group) {
        group.setAttribute('transform', `translate(${transform.x}, ${transform.y}) scale(${transform.k})`);
    }
    
    function fitToView() {
        const svg = document.getElementById('graphSvg');
        const group = document.getElementById('graphGroup');
        const bbox = group.getBBox();
        const svgRect = svg.getBoundingClientRect();
        
        const padding = 60;
        const scaleX = (svgRect.width - padding * 2) / bbox.width;
        const scaleY = (svgRect.height - padding * 2) / bbox.height;
        
        transform.k = Math.min(scaleX, scaleY, 1.5);
        transform.x = svgRect.width / 2 - (bbox.x + bbox.width / 2) * transform.k;
        transform.y = svgRect.height / 2 - (bbox.y + bbox.height / 2) * transform.k;
        
        applyTransform(group);
    }

    // ═══════════════════════════════════════════════════════════════
    // SELECTION & HIGHLIGHTING
    // ═══════════════════════════════════════════════════════════════
    
    function selectQuest(id) {
        selectedId = id;
        
        // Update sidebar
        document.querySelectorAll('.quest').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });
        
        // Update graph
        document.querySelectorAll('.node').forEach(el => {
            el.classList.toggle('selected', el.dataset.id === id);
        });
        
        highlightPath(id);
        showPanel(id);
        centerOnNode(id);
    }
    
    function highlightPath(id) {
        const pathIds = getAncestorPath(id);
        
        document.querySelectorAll('.node').forEach(el => {
            const inPath = pathIds.includes(el.dataset.id);
            el.classList.toggle('highlighted', inPath);
            el.classList.toggle('dimmed', !inPath && selectedId);
        });
        
        document.querySelectorAll('.link').forEach(el => {
            const inPath = pathIds.includes(el.dataset.from) && pathIds.includes(el.dataset.to);
            el.classList.toggle('highlighted', inPath);
            el.classList.toggle('dimmed', !inPath && selectedId);
        });
    }
    
    function getAncestorPath(id) {
        const path = [];
        const visited = new Set();
        
        function walk(qid) {
            if (visited.has(qid)) return;
            visited.add(qid);
            
            const quest = questMap.get(qid);
            if (!quest) return;
            
            quest.prerequisites.forEach(walk);
            path.push(qid);
        }
        
        walk(id);
        return path;
    }
    
    function clearHighlight() {
        document.querySelectorAll('.node, .link').forEach(el => {
            el.classList.remove('highlighted', 'dimmed');
        });
    }
    
    function centerOnNode(id) {
        const pos = nodePositions.get(id);
        if (!pos) return;
        
        const svg = document.getElementById('graphSvg');
        const group = document.getElementById('graphGroup');
        const rect = svg.getBoundingClientRect();
        
        transform.x = rect.width / 2 - pos.x * transform.k;
        transform.y = rect.height / 2 - pos.y * transform.k;
        
        applyTransform(group);
    }

    // ═══════════════════════════════════════════════════════════════
    // DETAIL PANEL
    // ═══════════════════════════════════════════════════════════════
    
    function showPanel(id) {
        const quest = questMap.get(id);
        if (!quest) return;
        
        const panel = document.getElementById('panel');
        const title = document.getElementById('panelTitle');
        const body = document.getElementById('panelBody');
        
        title.textContent = quest.name;
        
        const color = CONFIG.traderColors[quest.trader] || CONFIG.traderColors[''];
        
        let html = `<div class="meta">`;
        if (quest.trader) {
            html += `<span class="tag trader">${quest.trader}</span>`;
        }
        html += `<span class="tag location">${quest.group}</span>`;
        if (quest.inOneRound) {
            html += `<span class="tag warning">Single Round</span>`;
        }
        html += `</div>`;
        
        if (quest.requiredLocations.length > 0) {
            html += `<div class="section">
                <div class="section-title">Locations</div>
                <div class="meta">${quest.requiredLocations.map(l => `<span class="tag">${l}</span>`).join('')}</div>
            </div>`;
        }
        
        if (quest.objectives.length > 0) {
            html += `<div class="section">
                <div class="section-title">Objectives</div>
                ${quest.objectives.map(o => `
                    <div class="objective">
                        <span class="check"></span>
                        <span class="text">${o}</span>
                    </div>
                `).join('')}
            </div>`;
        }
        
        if (quest.rewards.length > 0) {
            html += `<div class="section">
                <div class="section-title">Rewards</div>
                ${quest.rewards.map(r => `
                    <div class="reward">
                        <div class="icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                        </div>
                        <div class="info">
                            <div class="name">${r.name}</div>
                            <div class="qty">×${r.quantity}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
        }
        
        if (quest.prerequisites.length > 0) {
            html += `<div class="section">
                <div class="section-title">Prerequisites</div>
                ${quest.prerequisites.map(pid => {
                    const p = questMap.get(pid);
                    return p ? `
                        <div class="link-item" data-id="${pid}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 19l-7-7 7-7"/>
                            </svg>
                            <span>${p.name}</span>
                        </div>
                    ` : '';
                }).join('')}
            </div>`;
        }
        
        const unlocks = data.quests.filter(q => q.prerequisites.includes(id));
        if (unlocks.length > 0) {
            html += `<div class="section">
                <div class="section-title">Unlocks</div>
                ${unlocks.map(u => `
                    <div class="link-item" data-id="${u.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 5l7 7-7 7"/>
                        </svg>
                        <span>${u.name}</span>
                    </div>
                `).join('')}
            </div>`;
        }
        
        body.innerHTML = html;
        
        body.querySelectorAll('.link-item').forEach(el => {
            el.addEventListener('click', () => selectQuest(el.dataset.id));
        });
        
        panel.classList.add('open');
    }
    
    function hidePanel() {
        document.getElementById('panel').classList.remove('open');
        selectedId = null;
        clearHighlight();
        document.querySelectorAll('.quest, .node').forEach(el => el.classList.remove('active', 'selected'));
    }

    // ═══════════════════════════════════════════════════════════════
    // CONTROLS
    // ═══════════════════════════════════════════════════════════════
    
    function setupControls() {
        const group = document.getElementById('graphGroup');
        
        document.getElementById('zoomIn').addEventListener('click', () => {
            transform.k = Math.min(4, transform.k * 1.3);
            applyTransform(group);
        });
        
        document.getElementById('zoomOut').addEventListener('click', () => {
            transform.k = Math.max(0.1, transform.k / 1.3);
            applyTransform(group);
        });
        
        document.getElementById('fitView').addEventListener('click', fitToView);
        document.getElementById('closePanel').addEventListener('click', hidePanel);
        
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') hidePanel();
            if (e.key === '+' || e.key === '=') {
                transform.k = Math.min(4, transform.k * 1.2);
                applyTransform(group);
            }
            if (e.key === '-') {
                transform.k = Math.max(0.1, transform.k / 1.2);
                applyTransform(group);
            }
            if (e.key === '0') fitToView();
        });
        
        window.addEventListener('resize', debounce(fitToView, 200));
    }

    // ═══════════════════════════════════════════════════════════════
    // LEGEND & STATS
    // ═══════════════════════════════════════════════════════════════
    
    function setupLegend() {
        const el = document.getElementById('legendTraders');
        Object.entries(CONFIG.traderColors).forEach(([name, color]) => {
            if (!name) return;
            el.innerHTML += `
                <div class="legend-row">
                    <span class="dot" style="background: ${color}"></span>
                    <span>${name}</span>
                </div>
            `;
        });
    }
    
    function updateStats() {
        document.getElementById('questCount').textContent = data.quests.length;
        
        let linkCount = 0;
        data.quests.forEach(q => linkCount += q.prerequisites.length);
        document.getElementById('linkCount').textContent = linkCount;
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════
    
    function groupBy(arr, key) {
        return arr.reduce((acc, item) => {
            const k = item[key];
            (acc[k] = acc[k] || []).push(item);
            return acc;
        }, {});
    }
    
    function truncate(str, len) {
        return str.length > len ? str.slice(0, len - 1) + '…' : str;
    }
    
    function debounce(fn, ms) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), ms);
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // START
    // ═══════════════════════════════════════════════════════════════
    
    document.addEventListener('DOMContentLoaded', init);
})();
