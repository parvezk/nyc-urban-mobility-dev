/**
 * linear-migration.js
 * Run this directly via your terminal: node linear-migration.js
 * No external dependencies required!
 */

const API_KEY = process.env.LINEAR_KEY;
if (!API_KEY) {
  console.error("ERROR: LINEAR_KEY environment variable is not set.");
  console.error("Set it in your .env.local file or export it in your shell.");
  process.exit(1);
}

async function linearGraphQL(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json();
  if (data.errors) {
    console.error("GraphQL Error:", JSON.stringify(data.errors, null, 2));
    throw new Error("Linear GraphQL execution failed");
  }
  return data.data;
}

const PHASES = [
  {
    name: "Phase 0: Architecture Validation",
    tasks: [
      "Delete Mapbox keys and map data schemas",
      "Validate Carto Dark Matter style compatibility",
      "Convert 3D Buildings into .pmtiles"
    ]
  },
  {
    name: "Phase 1: Greenfield Rip & Replace",
    tasks: [
      "Bootstrap Next.js App Router project",
      "Install Deck.gl and MapLibre dependencies",
      "Delete legacy trips-layer and use standard Deck.gl TripsLayer",
      "Rebuild Map components to achieve parity"
    ]
  },
  {
    name: "Phase 2: Backend and Data Pipeline",
    tasks: [
      "Stand up Postgres/PostGIS (local + Supabase)",
      "Implement DuckDB preprocessing scripts",
      "Replace local file reads with API-backed queries"
    ]
  },
  {
    name: "Phase 3: Scale and Polish",
    tasks: [
      "Introduce production PMTiles pipeline",
      "Live edge caching strategy",
      "Implement GitHub Actions scheduled ingestion script"
    ]
  },
  {
    name: "Phase 4: UI Redesign & UX Refresh",
    tasks: [
      "Introduce Tailwind CSS and shadcn/ui",
      "Execute Figma Hand-off",
      "Implement minimalist editorial aesthetic"
    ]
  }
];

async function run() {
  console.log("Fetching Linear Workspace data...");
  const initData = await linearGraphQL(`
    query {
      teams { nodes { id name } }
      projects { 
        nodes { 
          id 
          name 
          url 
          projectMilestones { nodes { id name } }
        } 
      }
    }
  `);

  const teamId = initData.teams.nodes[0]?.id;
  if (!teamId) throw new Error("No team found in your Linear workspace.");

  const targetProject = initData.projects.nodes.find(p => p.url.includes("nyc-urban-mobility-dev"));
  if (!targetProject) throw new Error("Project 'nyc-urban-mobility-dev' not found!");

  const projectId = targetProject.id;
  console.log(`Found Project: ${targetProject.name} (ID: ${projectId})`);

  const existingMilestones = targetProject.projectMilestones.nodes;

  for (const phase of PHASES) {
    let milestoneId;
    const existing = existingMilestones.find(m => m.name === phase.name);

    if (existing) {
      milestoneId = existing.id;
      console.log(`\nMilestone already exists: ${phase.name} (ID: ${milestoneId})`);
    } else {
      console.log(`\nCreating Milestone: ${phase.name}`);
      const milestoneRes = await linearGraphQL(`
        mutation CreateMilestone($projectId: String!, $name: String!) {
          projectMilestoneCreate(input: { projectId: $projectId, name: $name }) {
            projectMilestone { id name }
          }
        }
      `, { projectId, name: phase.name });
      milestoneId = milestoneRes.projectMilestoneCreate.projectMilestone.id;
    }

    for (const taskName of phase.tasks) {
      console.log(`   Creating Issue: ${taskName}`);
      
      await linearGraphQL(`
        mutation CreateIssue($teamId: String!, $projectId: String!, $milestoneId: String!, $title: String!) {
          issueCreate(input: { 
            teamId: $teamId, 
            projectId: $projectId, 
            projectMilestoneId: $milestoneId,
            title: $title 
          }) {
            issue { id title }
          }
        }
      `, { teamId, projectId, milestoneId, title: taskName });
    }
  }

  console.log("\n✅ All milestones and issues have been successfully populated in Linear!");
}

run().catch(console.error);
