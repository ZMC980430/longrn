import { Note, KnowledgeGraph } from './knowledge-builder';

export interface Path {
  steps: Note[];
  type: 'quick' | 'deep';
}

export class PathPlanner {
  planPath(target: string, graph: KnowledgeGraph, userKnowledge: Set<string> = new Set()): Path[] {
    const targetNode = Array.from(graph.nodes.values()).find(n => n.title === target);
    if (!targetNode) throw new Error('Target not found in graph');

    const quickPath = this.bfsPath(targetNode, graph, userKnowledge);
    const deepPath = this.dfsPath(targetNode, graph, userKnowledge);

    return [quickPath, deepPath].filter(p => p.steps.length > 0);
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

      // Add neighbors
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

      // Add neighbors (reverse for DFS)
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