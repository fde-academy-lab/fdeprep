import { NextResponse } from "next/server";
import { publicView } from "@/lib/submissions/view";

/** The polling fallback for clients that cannot hold an event stream open. */
export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(await publicView(Number(id)));
  } catch {
    return NextResponse.json({ message: "That submission does not exist." }, { status: 404 });
  }
}
