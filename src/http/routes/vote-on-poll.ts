import z from "zod";
import { prisma } from "../../lib/prisma";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { redis } from "../../lib/redis";
import { voting } from "../../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/polls/:pollId/votes", async (req, res) => {
    const voteOnPollBody = z.object({
      pollOptionId: z.string().cuid(),
    });

    const voteOnPollParams = z.object({
      pollId: z.string().cuid(),
    });

    const { pollOptionId } = voteOnPollBody.parse(req.body);
    const { pollId } = voteOnPollParams.parse(req.params);

    let sessionId = req.cookies.sessionId;
    if (!sessionId) {
      sessionId = randomUUID();

      res.setCookie("sessionId", sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 dias
        signed: true,
        httpOnly: true,
      });
    } else {
      const previousVote = await prisma.vote.findUnique({
        where: {
          sessionId_pollId: {
            sessionId,
            pollId,
          },
        },
      });

      if (previousVote && previousVote.pollOptionId !== pollOptionId) {
        const [, votes] = await Promise.all([
          prisma.vote.delete({ where: { id: previousVote.id } }),
          redis.zincrby(pollId, -1, previousVote.pollOptionId),
        ]);

        voting.publish(pollId, {
          pollOptionId: previousVote.pollOptionId,
          votes: Number(votes),
        });
      } else if (previousVote) {
        return res
          .status(400)
          .send({ message: "Você já votou nesta enquete!" });
      }
    }

    await prisma.vote.create({
      data: {
        sessionId,
        pollId,
        pollOptionId,
      },
    });

    const votes = await redis.zincrby(pollId, 1, pollOptionId);

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes),
    });

    return res.status(201).send();
  });
}
