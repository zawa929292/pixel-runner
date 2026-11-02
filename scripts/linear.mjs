// Linear GraphQL API の最小クライアント（GitHub Actions の cron から使う）
const API = 'https://api.linear.app/graphql';
export const TEAM_KEY = process.env.LINEAR_TEAM_KEY ?? 'GAM';

export async function gql(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY is not set');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export async function issuesInState(stateName, labelName) {
  const filter = { team: { key: { eq: TEAM_KEY } }, state: { name: { eq: stateName } } };
  if (labelName) filter.labels = { name: { eq: labelName } };
  const data = await gql(
    `query($filter: IssueFilter) {
      issues(filter: $filter, orderBy: updatedAt) {
        nodes { id identifier title priority attachments { nodes { url } } }
      }
    }`,
    { filter },
  );
  return data.issues.nodes;
}

export async function moveIssue(issueId, stateName) {
  const data = await gql(
    `query($team: String!, $name: String!) {
      workflowStates(filter: { team: { key: { eq: $team } }, name: { eq: $name } }) { nodes { id } }
    }`,
    { team: TEAM_KEY, name: stateName },
  );
  const stateId = data.workflowStates.nodes[0]?.id;
  if (!stateId) throw new Error(`Workflow state not found: ${stateName}`);
  await gql(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, {
    id: issueId,
    stateId,
  });
}

export async function comment(issueId, body) {
  await gql(`mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`, {
    issueId,
    body,
  });
}

export function prNumbersOf(issue) {
  return issue.attachments.nodes
    .map((a) => a.url.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number);
}
