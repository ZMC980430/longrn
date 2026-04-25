import { Note, KnowledgeGraph } from './knowledge-builder.js';
import { EmbeddingEngine } from './embedding-engine.js';
import { ScoredNote } from './vector-store.js';
import { LearningStateManager, LearningStatus } from './learning-state-manager.js';

export interface Path {
  steps: Note[];
  type: 'quick' | 'deep' | 'semantic';
  scores?: number[];
  states?: LearningStatus[];
}

export class PathPlanner {
  planPath(target: string, graph: KnowledgeGraph, userKnowledge: Set<string> = new Set()): Path[] {
    const targetNode = Array.from(graph.nodes.values()).find(n => n.title === target);
    if (!targetNode) throw new Error('Target not found in graph');

    const quickPath = this.bfsPath(targetNode, graph, userKnowledge);
    const deepPath = this.dfsPath(targetNode, graph, userKnowledge);

    return [quickPath, deepPath].filter(p => p.steps.length > 0);
  }

  /**
   * Phase 3: 集成学习状态的路径规划
   * - 排除 mastered 节点（除非用户显式要求）
   * - 优先从 planned / in_progress 节点出发
   * - 为每个步骤附加学习状态标记
   */
  planPathWithState(
    target: string,
    graph: KnowledgeGraph,
    stateManager: LearningStateManager,
    excludeMastered: boolean = true,
  ): Path[] {
    const targetNode = Array.from(graph.nodes.values()).find(n => n.title === target);
    if (!targetNode) throw new Error('Target not found in graph');

    const masteredIds = excludeMastered ? stateManager.getMasteredIds() : new Set<string>();
    const userKnowledge = new Set<string>();
    if (excludeMastered) {
      for (const id of masteredIds) {
        const node = graph.nodes.get(id);
        if (node) userKnowledge.add(node.title);
      }
    }

    const quickPath = this.bfsPath(targetNode, graph, userKnowledge);
    const deepPath = this.dfsPath(targetNode, graph, userKnowledge);

    const attachStates = (p: Path): Path => ({
      ...p,
      states: p.steps.map(s => stateManager.getStatus(s.id)),
    });

    return [quickPath, deepPath].filter(p => p.steps.length > 0).map(attachStates);
  }

  async semanticPath(
    query: string,
    graph: KnowledgeGraph,
    embeddingEngine: EmbeddingEngine,
    userKnowledge: Set<string> = new Set(),
  ): Promise<Path> {
    // 1. Semantically search for the best target node
    const queryEmb = await embeddingEngine.embed(query);
    const notes = Array.from(graph.nodes.values());
    const scored = notes
      .filter(n => n.embeddings)
      .map(note => ({
        note,
        score: note.embeddings ? EmbeddingEngine.cosineSimilarity(queryEmb, note.embeddings) : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (scored.length === 0) throw new Error('No notes with embeddings found');

    const targetNode = scored[0].note;

    // 2. BFS to get connected steps
    const bfsResult = this.bfsPath(targetNode, graph, userKnowledge);

    if (bfsResult.steps.length <= 1) return bfsResult;

    // 3. Sort by semantic similarity to query
    const scores = bfsResult.steps.map(step => {
      if (!step.embeddings) return 0;
      return EmbeddingEngine.cosineSimilarity(queryEmb, step.embeddings);
    });

    // Keep target first, sort the rest by similarity
    const first = bfsResult.steps[0];
    const rest = bfsResult.steps.slice(1);
    const indexed = rest.map((step, i) => ({ step, score: scores[i + 1] }));
    indexed.sort((a, b) => b.score - a.score);

    const sorted = [first, ...indexed.map(x => x.step)];
    const sortedScores = [
      scores[0],
      ...indexed.map(x => x.score),
    ];

    return {
      steps: sorted,
      type: 'semantic',
      scores: sortedScores,
    };
  }

  /**
   * Phase 3: 语义路径 + 学习状态感知
   */
  async semanticPathWithState(
    query: string,
    graph: KnowledgeGraph,
    embeddingEngine: EmbeddingEngine,
    stateManager: LearningStateManager,
    excludeMastered: boolean = true,
  ): Promise<Path> {
    const masteredIds = excludeMastered ? stateManager.getMasteredIds() : new Set<string>();
    const userKnowledge = new Set<string>();
    if (excludeMastered) {
      for (const id of masteredIds) {
        const node = graph.nodes.get(id);
        if (node) userKnowledge.add(node.title);
      }
    }

    const result = await this.semanticPath(query, graph, embeddingEngine, userKnowledge);
    return {
      ...result,
      states: result.steps.map(s => stateManager.getStatus(s.id)),
    };
  }

  private bfsPath(start: Note, graph: KnowledgeGraph, userKnowledge: Set<string>): Path {
    const queue: Note[] = [start];
    const visited = new Set<string>();
    const path: Note[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node.id) || userKnowledge.has(node.title)) continue;
      visited.add(node.id);
      path.push(node);

      graph.edges.forEach(edge => {
        if (edge.from === node.id) {
          const neighbor = graph.nodes.get(edge.to);
          if (neighbor && !visited.has(neighbor.id)) {
            queue.push(neighbor);
          }
        }
      });
    }

    return { steps: path, type: 'quick' };
  }

  private dfsPath(start: Note, graph: KnowledgeGraph, userKnowledge: Set<string>): Path {
    const stack: Note[] = [start];
    const visited = new Set<string>();
    const path: Note[] = [];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node.id) || userKnowledge.has(node.title)) continue;
      visited.add(node.id);
      path.push(node);

      const neighbors: Note[] = [];
      graph.edges.forEach(edge => {
        if (edge.from === node.id) {
          const neighbor = graph.nodes.get(edge.to);
          if (neighbor) neighbors.push(neighbor);
        }
      });
      neighbors.reverse().forEach(n => stack.push(n));
    }

    return { steps: path, type: 'deep' };
  }
}