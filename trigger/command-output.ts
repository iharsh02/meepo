// What the bash tool shows the model. A blank string looks like a missing
// result, and the model runs the command again.
export function shownCommandOutput(result: string, max = 20_000) {
  const output =
    result.length > max
      ? `${result.slice(0, max)}\n… [cut: ${result.length - max} more characters]`
      : result
  return output.trim() ? output : "(no output)"
}
