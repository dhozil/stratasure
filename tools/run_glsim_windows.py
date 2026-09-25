import os
import sys


def _patch_windows_unlink():
    if os.name != "nt":
        return

    original_unlink = os.unlink

    def safe_unlink(path):
        try:
            return original_unlink(path)
        except PermissionError as error:
            if getattr(error, "winerror", None) != 32:
                raise
            return None

    os.unlink = safe_unlink


def _patch_v3_calldata():
    from genlayer_py.abi import calldata

    original_decode = calldata.decode

    def decode(raw):
        value = original_decode(raw)
        if isinstance(value, dict) and "method" not in value and "" in value:
            value = dict(value)
            value["method"] = value.pop("")
        return value

    calldata.decode = decode


def _patch_transaction_value():
    import glsim.server as server

    original_rpc = server.RPC_METHODS["eth_sendRawTransaction"]

    def send_raw_transaction(state, engine, params):
        raw_hex = server._positional(params, 0)
        eth_tx = server.decode_raw_transaction(raw_hex)
        gl_payload = server.decode_genlayer_payload(eth_tx["data"])
        user_value = gl_payload.get("user_value")
        if user_value is None:
            user_value = eth_tx["value"]
        previous_value = engine.vm.value
        engine.vm.value = int(user_value)
        try:
            return original_rpc(state, engine, params)
        finally:
            engine.vm.value = previous_value

    server.RPC_METHODS["eth_sendRawTransaction"] = send_raw_transaction


def main():
    _patch_windows_unlink()
    _patch_v3_calldata()
    _patch_transaction_value()
    from glsim.__main__ import main as glsim_main

    glsim_main()


if __name__ == "__main__":
    main()
