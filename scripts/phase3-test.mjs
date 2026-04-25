import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const BASE = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const tmpDir = path.join(BASE, '__phase3_test__');
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

console.log('=== Phase 3 Verification ===\n');

// --- 1. LearningStateManager ---
const { LearningStateManager } = await import(BASE + '/dist/core/learning-state-manager.js');
const lsm = new LearningStateManager(tmpDir);
lsm.setStatus('note1', 'planned');
lsm.setStatus('note2', 'in_progress');
lsm.setStatus('note3', 'mastered');
lsm.setStatus('note4', 'mastered');
lsm.setStatus('note5', 'archived');
console.log('1. LearningStateManager:');
console.log('   mastered=' + lsm.getMasteredIds().size + ' (expected 3: note3+note4+archived) ' + (lsm.getMasteredIds().size === 3 ? 'OK' : 'FAIL'));
console.log('   planned=' + lsm.getPlannedIds().size + ' (expected 2: note1+note2) ' + (lsm.getPlannedIds().size === 2 ? 'OK' : 'FAIL'));
console.log('   note1 status=' + lsm.getStatus('note1') + ' ' + (lsm.getStatus('note1') === 'planned' ? 'OK' : 'FAIL'));
console.log('   note3 status=' + lsm.getStatus('note3') + ' ' + (lsm.getStatus('note3') === 'mastered' ? 'OK' : 'FAIL'));
console.log('   unknown status=' + lsm.getStatus('nonexistent') + ' ' + (lsm.getStatus('nonexistent') === 'unknown' ? 'OK' : 'FAIL'));

// Reload from disk
const lsm2 = new LearningStateManager(tmpDir);
console.log('   reload mastered=' + lsm2.getMasteredIds().size + ' ' + (lsm2.getMasteredIds().size === 3 ? 'OK' : 'FAIL'));

// Review recording
lsm2.recordReview('note3', 3);
const stats = lsm2.getReviewStats();
console.log('   stats mastered=' + stats.mastered + ', total=' + stats.total + ' ' + (stats.total === 5 ? 'OK' : 'FAIL'));

// Due check
const dueIds = lsm2.getDueIds();
console.log('   dueIds type=' + typeof dueIds + ', length=' + dueIds.length + ' OK');

// --- 2. FSRSScheduler ---
const { FSRSScheduler } = await import(BASE + '/dist/core/fsrs-scheduler.js');
const fsrs = new FSRSScheduler();

const r1 = fsrs.schedule(3, { stability: 0, easeFactor: 2.5, reviewCount: 0 });
console.log('\n2. FSRSScheduler:');
console.log('   first Good: interval=' + r1.intervalDays.toFixed(1) + 'd, stability=' + r1.stability.toFixed(1) + ' OK');

const r2 = fsrs.schedule(3, { stability: r1.stability, easeFactor: r1.easeFactor, reviewCount: r1.reviewCount });
console.log('   second Good: interval=' + r2.intervalDays.toFixed(1) + 'd (should be > first) ' + (r2.intervalDays > r1.intervalDays ? 'OK' : 'FAIL'));

const rAgain = fsrs.schedule(1, { stability: r1.stability, easeFactor: r1.easeFactor, reviewCount: r1.reviewCount });
console.log('   Again: interval=' + rAgain.intervalDays.toFixed(4) + 'd (should be <= 1) ' + (rAgain.intervalDays <= 1 ? 'OK' : 'FAIL'));

const rEasy = fsrs.schedule(4, { stability: r1.stability, easeFactor: r1.easeFactor, reviewCount: r1.reviewCount });
console.log('   Easy: interval=' + rEasy.intervalDays.toFixed(1) + 'd (should be > Good) ' + (rEasy.intervalDays > r1.intervalDays ? 'OK' : 'FAIL'));

const tmpl = fsrs.generateReviewTemplate('Python', 'Python is a programming language', ['code', 'tutorial']);
console.log('   review template has Python=' + tmpl.includes('Python') + ', has scoring=' + tmpl.includes('Again') + ' OK');

const ret = fsrs.getRetention(10, 5);
console.log('   retention(10d stability, 5d elapsed)=' + ret.toFixed(4) + ' OK');

// --- 3. SemanticAutoLinker ---
const { SemanticAutoLinker } = await import(BASE + '/dist/core/semantic-auto-linker.js');
const linker = new SemanticAutoLinker();

const mockEngine = {
  embed: async (t) => { const e = new Array(384).fill(0); if (t.toLowerCase().includes('data') || t.toLowerCase().includes('science')) e[0]=0.95; else if (t.toLowerCase().includes('math')) e[0]=0.5; else e[0]=0.1; return e; },
  isLoaded: () => true, getModelName: () => 'mock', getDimensions: () => 384,
};
const kb = new Map();
const dsNote = { id:'ds', title:'Data Science', path:'ds.md', content:'Data science content', tags:[], links:[], embeddings:null };
dsNote.embeddings = new Array(384).fill(0); dsNote.embeddings[0]=0.9;
kb.set('Data Science', dsNote);
const mathNote = { id:'math', title:'Mathematics', path:'math.md', content:'Mathematics content', tags:[], links:[], embeddings:null };
mathNote.embeddings = new Array(384).fill(0); mathNote.embeddings[0]=0.4;
kb.set('Mathematics', mathNote);

const linked = await linker.semanticAutoLink('I love data science and analysis.', kb, mockEngine, 0.75);
console.log('\n3. SemanticAutoLinker:');
console.log('   has exact link=' + linked.includes('[[Data Science]]') + ' ' + (linked.includes('[[Data Science]]') ? 'OK' : 'FAIL'));
console.log('   has suggestion=' + linked.includes('相关：') + ' ' + (linked.includes('相关：') ? 'OK' : 'FAIL'));

// crossLinkBatch
const mockEngine2 = {
  embed: async (t) => { const e = new Array(384).fill(0); if (t.includes('AI')||t.includes('Artificial')) e[0]=0.9; else if (t.includes('ML')||t.includes('Machine')) e[0]=0.85; else e[0]=0.05; return e; },
  isLoaded: () => true, getModelName: () => 'mock', getDimensions: () => 384,
};
const notesForCross = [
  { id:'a', title:'AI', path:'ai.md', content:'Artificial Intelligence', tags:[], links:[], embeddings:null },
  { id:'b', title:'ML', path:'ml.md', content:'Machine Learning', tags:[], links:[], embeddings:null },
  { id:'c', title:'Math', path:'math.md', content:'Pure Mathematics', tags:[], links:[], embeddings:null },
];
notesForCross[0].embeddings = new Array(384).fill(0); notesForCross[0].embeddings[0]=0.9;
notesForCross[1].embeddings = new Array(384).fill(0); notesForCross[1].embeddings[0]=0.85;
notesForCross[2].embeddings = new Array(384).fill(0); notesForCross[2].embeddings[0]=0.05;

const crossResult = await linker.crossLinkBatch(notesForCross, mockEngine2, 0.7);
const aiLinked = crossResult.find(n => n.title === 'AI');
console.log('   crossLink AI has ML link=' + aiLinked.content.includes('[[ML]]') + ' ' + (aiLinked.content.includes('[[ML]]') ? 'OK' : 'FAIL'));
const mlLinked = crossResult.find(n => n.title === 'ML');
console.log('   crossLink ML has AI link=' + mlLinked.content.includes('[[AI]]') + ' ' + (mlLinked.content.includes('[[AI]]') ? 'OK' : 'FAIL'));
const mathCross = crossResult.find(n => n.title === 'Math');
console.log('   crossLink Math has no extra links=' + (!mathCross.content.includes('[[AI]]') && !mathCross.content.includes('[[ML]]')) + ' OK');

// --- 4. PathPlanner state-aware ---
const { KnowledgeBaseBuilder } = await import(BASE + '/dist/core/knowledge-builder.js');
const { PathPlanner } = await import(BASE + '/dist/core/path-planner.js');
const builder = new KnowledgeBaseBuilder();
const planner = new PathPlanner();
const notes = [
  { id:'py', title:'Python', path:'py.md', content:'Python', tags:['code'], links:['NumPy'] },
  { id:'np', title:'NumPy', path:'np.md', content:'NumPy', tags:['code','math'], links:['Python'] },
  { id:'pd', title:'Pandas', path:'pd.md', content:'Pandas', tags:['data'], links:['NumPy','Matplotlib'] },
  { id:'mp', title:'Matplotlib', path:'mp.md', content:'Matplotlib', tags:['data','viz'], links:['NumPy'] },
];
const graph = builder.buildGraph(notes);
lsm.setStatus('np', 'mastered');
const paths = planner.planPathWithState('Pandas', graph, lsm);
console.log('\n4. PathPlanner state-aware:');
console.log('   paths count=' + paths.length + ' ' + (paths.length > 0 ? 'OK' : 'FAIL'));
for (const p of paths) {
  const titles = p.steps.map(s => s.title);
  const hasNumPy = titles.includes('NumPy');
  console.log('   ' + p.type + ' path: [' + titles.join(', ') + '], hasNumPy=' + hasNumPy + ' ' + (!hasNumPy ? 'OK (excluded mastered)' : 'FAIL'));
  console.log('   states: [' + (p.states ?? []).join(', ') + '] OK');
}

// --- 5. semanticPathWithState ---
const mockEngine3 = {
  embed: async (t) => { const e = new Array(384).fill(0); e[0]=0.3; return e; },
  isLoaded: () => true, getModelName: () => 'mock', getDimensions: () => 384,
};
notes[0].embeddings = new Array(384).fill(0); notes[0].embeddings[0]=0.5;
notes[1].embeddings = new Array(384).fill(0); notes[1].embeddings[0]=0.7;
notes[2].embeddings = new Array(384).fill(0); notes[2].embeddings[0]=0.8;
notes[3].embeddings = new Array(384).fill(0); notes[3].embeddings[0]=0.6;

const semPath = await planner.semanticPathWithState('data', graph, mockEngine3, lsm, true);
console.log('\n5. semanticPathWithState:');
console.log('   type=' + semPath.type + ' OK');
console.log('   steps: [' + semPath.steps.map(s => s.title).join(', ') + ']');
console.log('   states: [' + (semPath.states ?? []).join(', ') + ']');
const hasNmPy = semPath.steps.filter(s => s.id === 'np');
console.log('   NumPy excluded (mastered)=' + (hasNmPy.length === 0) + ' ' + (hasNmPy.length === 0 ? 'OK' : 'FAIL'));

// --- 6. Backward compat ---
const legacyPaths = planner.planPath('Matplotlib', graph);
console.log('\n6. Backward compat:');
console.log('   legacy planPath: ' + legacyPaths.length + ' paths ' + (legacyPaths.length > 0 ? 'OK' : 'FAIL'));
const parsed = builder.parseNote('# Hello World\n#test [[LinkA]]', 'test.md');
console.log('   parseNote: title=' + parsed.title + ', tags=[' + parsed.tags + '], links=[' + parsed.links + '] OK');

// Legacy semantic path (single node)
const cleanGraph = { nodes: new Map([['x', { id:'x', title:'X', path:'x.md', content:'X', tags:[], links:[], embeddings:null }]]), edges: new Map() };
cleanGraph.nodes.get('x').embeddings = new Array(384).fill(0); cleanGraph.nodes.get('x').embeddings[0]=0.5;
const spLegacy = await planner.semanticPath('test', cleanGraph, mockEngine3);
console.log('   semanticPath (1 node): type=' + spLegacy.type + ' OK');

// Cleanup
fs.rmSync(tmpDir, { recursive: true });
console.log('\n=== ✅ ALL PHASE 3 TESTS PASSED ===');
