"""Authoring package version lookup shared by model and serializer."""

from importlib.metadata import PackageNotFoundError, version


def _authoring_version() -> str:
    try:
        return version("ibl-ephys-atlas")
    except PackageNotFoundError:
        from ephys_atlas_builder import __version__ as editable_version

        return editable_version
