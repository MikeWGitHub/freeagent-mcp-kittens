import { FreeAgentApiClient } from "../services/api-client.js";
import { ResponseFormat } from "../constants.js";
import type { FreeAgentTask } from "../types.js";
import type { ListTasksInput, GetTaskInput, CreateTaskInput, UpdateTaskInput } from "../schemas/index.js";

/**
 * List all tasks in FreeAgent
 */
export async function listTasks(
  apiClient: FreeAgentApiClient,
  params: ListTasksInput
): Promise<string> {
  const queryParams = new URLSearchParams();

  if (params.view) queryParams.set("view", params.view);
  if (params.project) queryParams.set("project", params.project);
  if (params.updated_since) queryParams.set("updated_since", params.updated_since);
  if (params.sort) queryParams.set("sort", params.sort);
  if (params.page) queryParams.set("page", params.page.toString());
  if (params.per_page) queryParams.set("per_page", params.per_page.toString());

  const url = `/tasks${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
  const response = await apiClient.get<{ tasks: FreeAgentTask[] }>(url);

  if (!response.data.tasks || response.data.tasks.length === 0) {
    return "No tasks found.";
  }

  if (params.response_format === ResponseFormat.JSON) {
    return JSON.stringify(response.data.tasks, null, 2);
  }

  const taskList = response.data.tasks
    .map((task: FreeAgentTask) => {
      return [
        `Task: ${task.name}`,
        `  URL: ${task.url}`,
        `  Project: ${task.project}`,
        `  Status: ${task.status}`,
        `  Billable: ${task.is_billable ? "Yes" : "No"}`,
        task.billing_rate ? `  Billing Rate: ${task.billing_rate} per ${task.billing_period}` : null,
        `  Currency: ${task.currency}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `Found ${response.data.tasks.length} task(s):\n\n${taskList}`;
}

/**
 * Get details of a specific task
 */
export async function getTask(
  apiClient: FreeAgentApiClient,
  params: GetTaskInput
): Promise<string> {
  const taskId = params.task_id.replace(/^.*\/tasks\//, "");
  const response = await apiClient.get<{ task: FreeAgentTask }>(`/tasks/${taskId}`);
  const task = response.data.task;

  if (params.response_format === ResponseFormat.JSON) {
    return JSON.stringify(task, null, 2);
  }

  const details = [
    `Task Details:`,
    `  Name: ${task.name}`,
    `  URL: ${task.url}`,
    `  Project: ${task.project}`,
    `  Status: ${task.status}`,
    `  Billable: ${task.is_billable ? "Yes" : "No"}`,
    task.billing_rate ? `  Billing Rate: ${task.billing_rate}` : null,
    task.billing_period ? `  Billing Period: ${task.billing_period}` : null,
    `  Currency: ${task.currency}`,
    `  Is deletable: ${task.is_deletable}`,
    `  Created: ${task.created_at}`,
    `  Updated: ${task.updated_at}`,
  ]
    .filter(Boolean)
    .join("\n");

  return details;
}

/**
 * Create a new task in FreeAgent
 */
export async function createTask(
  apiClient: FreeAgentApiClient,
  params: CreateTaskInput
): Promise<string> {
  const taskData: Record<string, unknown> = {
    name: params.name,
    project: params.project,
    is_billable: params.is_billable ?? true,
    status: params.status || "Active",
  };

  if (params.billing_rate) taskData.billing_rate = params.billing_rate;
  if (params.billing_period) taskData.billing_period = params.billing_period;

  const response = await apiClient.post<{ task: FreeAgentTask }>("/tasks", { task: taskData });
  const task = response.data.task;

  return [
    `Task created successfully!`,
    `  Name: ${task.name}`,
    `  URL: ${task.url}`,
    `  Project: ${task.project}`,
    `  Status: ${task.status}`,
    `  Billable: ${task.is_billable ? "Yes" : "No"}`,
    task.billing_rate ? `  Billing Rate: ${task.billing_rate} per ${task.billing_period}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Update an existing task. Only provided fields are changed.
 */
export async function updateTask(
  apiClient: FreeAgentApiClient,
  params: UpdateTaskInput
): Promise<string> {
  const id = params.task_id.startsWith("http")
    ? params.task_id.split("/").pop()!
    : params.task_id;

  const { task_id: _taskId, ...fields } = params;
  void _taskId;
  const taskData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) taskData[key] = value;
  }
  if (Object.keys(taskData).length === 0) {
    throw new Error("No fields to update: provide at least one updatable field.");
  }

  const response = await apiClient.put<{ task: FreeAgentTask }>(
    `/tasks/${id}`,
    { task: taskData }
  );
  const task = response.data.task;

  return (
    `\u2705 Task "${task.name}" updated (ID: ${id})\n\n` +
    `**Status**: ${task.status}\n` +
    `**Billable**: ${task.is_billable}\n` +
    `**URL**: ${task.url}`
  );
}
