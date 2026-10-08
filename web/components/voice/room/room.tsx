// Stub: replaced by the drawn room at integration.
export type RoomSize = "lobby" | "debrief";
export type RoomPerson = { slug: string; name: string; role: string };

export function InterviewRoom(props: { interviewers: RoomPerson[]; size: RoomSize }): React.JSX.Element {
  const label = props.interviewers.map((person) => `${person.name}, ${person.role}`).join("; ");
  return (
    <svg width={props.size === "lobby" ? 400 : 240} height={props.size === "lobby" ? 240 : 144}
         role="img" aria-label={`${label}, at the interview table`} />
  );
}
