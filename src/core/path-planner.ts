import { Note, KnowledgeGraph } from './knowledge-builder.js';
import { EmbeddingEngine } from './embedding-engine.js';
import { LearningStateManager, LearningStatus } from './learning-state-manager.js';

/**
 * A recommended learning path consisting of ordered steps (notes).
 */
export interface Path {
  /** Ordered list of notes from foundational to target */
  steps: Note[];
  /** Algorithm type: quick (BFS), deep (DFS), or semantic (embedding-based) */
  type: 'quick' | 'deep' | 'semantic';
  /** Semantic similarity scores corresponding to each step (only for semantic paths) */
  scores?: number[];
  /** Learning status of each step (only populated by state-aware methods) */
  states?: LearningStatus[];
}

/**
 * Generates learning paths through a knowledge graph.
 *
 * Supports three path strategies:
 * - **planPath** — BFS (quick) and DFS (deep) from a named target.
 * - **semanticPath** — Finds the most semantically relevant target from a query,
 *   then builds a path and re-ranks steps by similarity.
 * - **planPathWithState / semanticPathWithState** — Same as above but integrates
 *   LearningStateManager to exclude mastered nodes and attach status labels.
 */
export class PathPlanner {
  /**
   * Generates both a quick (BFS) and deep (DFS) learning path to a target.
   * @param target - Title of the target note
   * @param graph - The knowledge graph
   * @param userKnowledge - Titles of notes the user already knows (will be skipped)
   * @returns Array of one or more non-empty Paths
   */
  planPath(target: string, graph: KnowledgeGraph, userKnowledge: Set<string> = new Set()): Path[] {
    const targetNode = Array.from(graph.nodes.values()).find(n => n.title === target);
    if (!targetNode) throw new Error('Target not found in graph');

    const quickPath = this.bfsPath(targetNode, graph, userKnowledge);
    const deepPath = this.dfsPath(targetNode, graph, userKnowledge);

    return [quickPath, deepPath].filter(p => p.steps.length > 0);
  }

  /**
   * Phase 3: State-aware path planning.
   * - Excludes mastered nodes (unless `excludeMastered` is false).
   * - Attaches each step's learning status.
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

  /**
   * Phase 2: Semantic path planning using a natural-language query.
   * 1. Embeds the query and finds the top-5 most similar notes.
   * 2. Runs BFS from the best match.
   * 3. Re-ranks steps by semantic similarity to the query.
   */
  async semanticPath(
    query: string,
    graph: KnowledgeGraph,
    embeddingEngine: EmbeddingEngine,
    userKnowledge: Set<string> = new Set(),
  ): Promise<Path> {
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

    const bfsResult = this.bfsPath(targetNode, graph, userKnowledge);

    if (bfsResult.steps.length <= 1) return bfsResult;

    const scores = bfsResult.steps.map(step => {
      if (!step.embeddings) return 0;
      return EmbeddingEngine.cosineSimilarity(queryEmb, step.embeddings);
    });

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
   * Phase 3: Semantic path + state awareness.
   * Combines semanticPath() with LearningStateManager.
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

  /**
   * BFS traversal from start node.
   * Produces a "quick" path: broad exploration, shortest dependency chain.
   */
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

  /**
   * DFS traversal from start node.
   * Produces a "deep" path: dives deep into one branch before backtracking.
   */
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