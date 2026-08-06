import { SchedulerLockService } from './scheduler-lock.service';

describe('SchedulerLockService', () => {
  it('prevents in-process reentry for the same lease name', async () => {
    let releaseTask: (() => void) | null = null;
    const taskDone = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    const db = {
      jobLease: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const service = new SchedulerLockService(db as never);
    const taskOne = jest.fn(async () => {
      await taskDone;
      return 'first';
    });
    const taskTwo = jest.fn(async () => 'second');

    const firstRun = service.runWithLease('cron:test:job', 1_000, taskOne);
    const secondRun = await service.runWithLease('cron:test:job', 1_000, taskTwo);

    expect(secondRun).toBeNull();
    expect(taskTwo).not.toHaveBeenCalled();

    if (releaseTask) {
      (releaseTask as () => void)();
    }
    const firstResult = await firstRun;
    expect(firstResult).toBe('first');
  });
});
