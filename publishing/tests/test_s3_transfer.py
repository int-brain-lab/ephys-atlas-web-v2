from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock
from types import SimpleNamespace

import pytest

from ibl_ephys_atlas_publish.s3 import Destination, IMMUTABLE_CACHE
from ibl_ephys_atlas_publish.s3_assets import asset_plan, publish_assets
from ibl_ephys_atlas_publish.s3_transfer import run_independent
from test_s3 import FakeS3


def test_transfer_bounds_work_and_processes_every_item():
    barrier = Barrier(2)
    lock = Lock()
    completed = []
    active = peak = 0

    def operation(item):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        barrier.wait(timeout=5)
        with lock:
            completed.append(item)
            active -= 1

    run_independent(SimpleNamespace(max_workers=2), operation, range(10))
    assert sorted(completed) == list(range(10))
    assert peak == 2


def test_failed_phase_waits_for_inflight_work_before_returning():
    entered = Event()
    failed = Event()
    release = Event()
    finished = Event()

    def operation(item):
        if item == 0:
            entered.set()
            assert release.wait(5)
            finished.set()
        else:
            assert entered.wait(5)
            failed.set()
            raise RuntimeError("dependency failed")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run_independent, SimpleNamespace(max_workers=2), operation, [0, 1])
        assert failed.wait(5)
        assert not future.done()
        release.set()
        with pytest.raises(RuntimeError, match="dependency failed"):
            future.result(timeout=5)
        assert finished.is_set()


def test_parallel_asset_failure_does_not_publish_entry_and_retry_completes(tmp_path):
    class InterruptedS3(FakeS3):
        max_workers = 2
        interrupt = True

        def put(self, key, path, **kwargs):
            if self.interrupt and key.endswith('/b.bin') and kwargs['cache_control'] == IMMUTABLE_CACHE:
                raise RuntimeError('public dependency interrupted')
            return super().put(key, path, **kwargs)

    for name in ('a.bin', 'b.bin', 'manifest.json'):
        (tmp_path / name).write_text('{}')
    destination, store = Destination('production'), InterruptedS3()
    plan = asset_plan(tmp_path, destination, 'projection', 'test-only-v1', ['a.bin', 'b.bin', 'manifest.json'])
    entry = destination.key(plan['prefix'] + 'manifest.json')
    with pytest.raises(RuntimeError, match='public dependency interrupted'):
        publish_assets(tmp_path, destination, plan, store)
    assert entry not in store.objects
    assert destination.key(plan['prefix'] + '_publication.json') not in store.objects
    store.interrupt = False
    publish_assets(tmp_path, destination, plan, store)
    assert entry in store.objects
    public = [key for key in store.writes if '/_staging/' not in key]
    assert public.index(entry) > public.index(destination.key(plan['prefix'] + 'a.bin'))
    assert public.index(entry) > public.index(destination.key(plan['prefix'] + 'b.bin'))


@pytest.mark.parametrize('workers', [0, 33, True, '2'])
def test_invalid_worker_limit_fails_before_work(workers):
    with pytest.raises(ValueError, match='workers'):
        run_independent(SimpleNamespace(max_workers=workers), lambda _: pytest.fail('must not run'), [1])
