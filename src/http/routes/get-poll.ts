import z from "zod";
import { prisma } from "../../lib/prisma";
import { FastifyInstance } from "fastify";
import { redis } from "../../lib/redis";

export async function getPoll(app: FastifyInstance) {
  app.get("/polls/:pollId", async (req, res) => {
    const getPollParams = z.object({
      pollId: z.string().cuid(),
    });

    const { pollId } = getPollParams.parse(req.params);

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        options: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!poll) {
      return res.status(400).send({ message: "Enquete não encontrada." });
    }

    const result = await redis.zrange(pollId, 0, -1, "WITHSCORES");

    const votes: Record<string, number> = {};
    for (let i = 0; i < result.length; i += 2) {
      votes[result[i]] = Number(result[i + 1]) || 0;
    }

    return {
      poll: {
        id: poll.id,
        title: poll.title,
        options: poll.options.map((option) => ({
          id: option.id,
          title: option.title,
          votes: votes[option.id] ?? 0,
        })),
      },
    };
  });
}
