"""Bounded parallel work inside publication phases, never across commit barriers."""
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait


def run_independent(store, operation, items):
    """Finish every in-flight operation before returning or propagating a failure.

    CLI and in-memory stores stay serial unless they explicitly support workers.
    Callers must keep reservations, entry objects and mutable commits outside
    this helper, and submit only independent object operations within a phase.
    """
    workers = getattr(store, "max_workers", 1)
    if type(workers) is not int or not 1 <= workers <= 32:
        raise ValueError("S3 transfer workers must be an integer between 1 and 32")
    if workers == 1:
        for item in items:
            operation(item)
        return
    iterator = iter(items)
    exhausted = object()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        pending = set()
        try:
            for _ in range(workers):
                item = next(iterator, exhausted)
                if item is exhausted:
                    break
                pending.add(executor.submit(operation, item))
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in done:
                    future.result()
                for _ in done:
                    item = next(iterator, exhausted)
                    if item is not exhausted:
                        pending.add(executor.submit(operation, item))
        except BaseException:
            for future in pending:
                future.cancel()
            raise
