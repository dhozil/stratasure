"""Shared helpers for direct mode tests."""

import os
import sys

from gltest.direct import loader as direct_loader
from gltest.direct.vm import VMContext


_VALIDATOR_SENTINEL = object()


def _load_calldata():
    from genlayer.py import calldata
    return calldata


def _load_types():
    from genlayer.py import types
    return types


direct_loader.import_calldata = _load_calldata
direct_loader.import_address = lambda: _load_types().Address
direct_loader.import_lazy = lambda: _load_types().Lazy


_original_refresh_gl_message = VMContext._refresh_gl_message


def _refresh_gl_message(self):
    _original_refresh_gl_message(self)
    module = sys.modules.get("genlayer.gl")
    if module is None:
        return
    types = _load_types()
    sender = self.sender
    origin = self.origin
    contract_address = self._contract_address
    if sender is not None and not isinstance(sender, types.Address):
        sender = types.Address(sender)
    if origin is not None and not isinstance(origin, types.Address):
        origin = types.Address(origin)
    if contract_address is not None and not isinstance(contract_address, types.Address):
        contract_address = types.Address(contract_address)
    module.message = module.MessageType(
        contract_address=contract_address,
        sender_address=sender,
        origin_address=origin,
        value=types.u256(self._value),
        chain_id=types.u256(self._chain_id),
    )
    if isinstance(getattr(module, "message_raw", None), dict):
        module.message_raw.update({
            "contract_address": contract_address,
            "sender_address": sender,
            "origin_address": origin,
            "value": self._value,
            "chain_id": self._chain_id,
        })


def _run_validator(self, *, leader_result=_VALIDATOR_SENTINEL, leader_error=None, index=-1):
    from gltest.direct.vm import _sentinel
    from genlayer.gl import vm as gl_vm

    if not self._captured_validators:
        raise RuntimeError("No validator captured. Call a contract method that uses gl.vm.run_nondet before calling run_validator().")
    stored_result, leader_fn, validator_fn = self._captured_validators[index]
    if leader_error is not None:
        wrapped = gl_vm.UserError(str(leader_error))
    elif leader_result is not _VALIDATOR_SENTINEL:
        wrapped = gl_vm.Return(calldata=leader_result)
    else:
        wrapped = gl_vm.Return(calldata=stored_result)
    return validator_fn(wrapped)


VMContext._refresh_gl_message = _refresh_gl_message
VMContext.run_validator = _run_validator


def _patch_run_nondet_for_direct_mode():
    try:
        import genlayer.gl.nondet.web as web
        import genlayer.gl.vm as gl_vm
    except ImportError:
        return

    def _get(url, *, headers=None):
        from gltest.direct import wasi_mock
        vm = wasi_mock.get_vm()
        for index, (pattern, response) in enumerate(vm._web_mocks):
            if pattern.search(url):
                vm._web_mocks_hit.add(index)
                body = response.get("body")
                if isinstance(body, str):
                    body = body.encode("utf-8")
                return web.Response(status=response["status"], headers={}, body=body)
        return web.Response(status=503, headers={}, body=None)

    web.get = _get

    def _direct_run_nondet(leader_fn, validator_fn, /, **kwargs):
        from gltest.direct import wasi_mock
        vm = wasi_mock.get_vm()
        vm._in_nondet = True
        try:
            result = leader_fn()
        finally:
            vm._in_nondet = False
        vm._captured_validators.append((result, leader_fn, validator_fn))
        return result

    gl_vm.run_nondet = _direct_run_nondet
    gl_vm.run_nondet_default = _direct_run_nondet


direct_loader._patch_run_nondet_for_direct_mode = _patch_run_nondet_for_direct_mode


def _allocate_contract(contract_cls, vm, *args, **kwargs):
    from genlayer.py.storage import ROOT_SLOT_ID
    from genlayer.py.storage._internal.generate import ORIGINAL_INIT_ATTR, _storage_build

    type_desc = _storage_build(contract_cls, {})
    slot = vm._storage.get_store_slot(ROOT_SLOT_ID)
    instance = type_desc.get(slot, 0)
    init = getattr(type_desc, "cls", None)
    if init is None:
        init = getattr(contract_cls, "__init__", None)
    else:
        init = getattr(init, "__init__", None)
    if init is not None:
        if hasattr(init, ORIGINAL_INIT_ATTR):
            init = getattr(init, ORIGINAL_INIT_ATTR)
        init(instance, *args, **kwargs)
    return instance


direct_loader._allocate_contract = _allocate_contract


_original_unlink = os.unlink


def _unlink(path):
    try:
        _original_unlink(path)
    except PermissionError:
        if os.name != "nt":
            raise


os.unlink = _unlink


def to_hex(addr_bytes):
    """Convert an address fixture to a checksummed hexadecimal string."""
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    try:
        from genlayer.types import Address
    except ImportError:
        from genlayer.py.types import Address

    return Address(addr_bytes).as_hex
