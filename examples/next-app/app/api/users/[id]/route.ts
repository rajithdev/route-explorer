type Context = { params: Promise<{ id: string }> };

export const GET = async (_request: Request, { params }: Context) => {
  return Response.json({ id: (await params).id });
};

const remove = async () => new Response(null, { status: 204 });

export { remove as DELETE };
