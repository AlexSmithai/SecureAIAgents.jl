function call_tee_secure_function(input::String)
    lib_path = joinpath(@__DIR__, "../../lib/libtee.so")
    lib = try
        Libdl.dlopen(lib_path)
    catch e
        error("Failed to load libtee.so: $e. Ensure the library is compiled in lib/.")
    end

    sym = try
        Libdl.dlsym(lib, :tee_secure_process)
    catch e
        Libdl.dlclose(lib)
        error("Failed to find tee_secure_process: $e")
    end

    result_ptr = try
        ccall(sym, Cstring, (Cstring,), input)
    catch e
        Libdl.dlclose(lib)
        error("Failed to call tee_secure_process: $e")
    end

    result = unsafe_string(result_ptr)
    Libdl.dlclose(lib)
    return result
end
