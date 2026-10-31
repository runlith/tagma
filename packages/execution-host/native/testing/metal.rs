use std::ffi::{CStr, c_char, c_void};

type Id = *mut c_void;
type Sel = *const c_void;

#[link(name = "Metal", kind = "framework")]
unsafe extern "C" { fn MTLCreateSystemDefaultDevice() -> Id; }

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_msgSend();
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_release(object: Id);
    fn objc_autoreleasePoolPush() -> Id;
    fn objc_autoreleasePoolPop(pool: Id);
}

struct Object(Id);

impl Drop for Object {
    fn drop(&mut self) { unsafe { objc_release(self.0); } }
}

struct Pool(Id);

impl Pool {
    fn new() -> Self { Self(unsafe { objc_autoreleasePoolPush() }) }
}

impl Drop for Pool {
    fn drop(&mut self) { unsafe { objc_autoreleasePoolPop(self.0); } }
}

fn selector(name: &CStr) -> Sel { unsafe { sel_registerName(name.as_ptr()) } }

fn object(receiver: Id, name: &CStr) -> Id {
    let send: unsafe extern "C" fn(Id, Sel) -> Id = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { send(receiver, selector(name)) }
}

fn tell(receiver: Id, name: &CStr) {
    let send: unsafe extern "C" fn(Id, Sel) = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
    unsafe { send(receiver, selector(name)); }
}

fn retained(value: Id, name: &str) -> Result<Object, String> {
    if value.is_null() { Err(format!("Metal could not create {name}")) } else { Ok(Object(value)) }
}

#[repr(C)]
struct Range { location: usize, length: usize }

pub struct Work {
    queues: [Object; 2],
    buffers: [Object; 2],
    _device: Object,
}

impl Work {
    pub fn open() -> Result<Option<Self>, String> {
        let _pool = Pool::new();
        let device = unsafe { MTLCreateSystemDefaultDevice() };
        if device.is_null() { return Ok(None); }
        let device = Object(device);
        let queues = [retained(object(device.0, c"newCommandQueue"), "first queue")?, retained(object(device.0, c"newCommandQueue"), "second queue")?];
        if queues[0].0 == queues[1].0 { return Err("Metal did not create distinct command queues".into()); }
        let buffer: unsafe extern "C" fn(Id, Sel, usize, usize) -> Id = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        let first = unsafe { buffer(device.0, selector(c"newBufferWithLength:options:"), 8 * 1024 * 1024, 32) };
        let first = retained(first, "first private buffer")?;
        let second = unsafe { buffer(device.0, selector(c"newBufferWithLength:options:"), 8 * 1024 * 1024, 32) };
        let second = retained(second, "second private buffer")?;
        Ok(Some(Self { queues, buffers: [first, second], _device: device }))
    }

    pub fn complete(&self, queue: usize) -> Result<f64, String> {
        let _pool = Pool::new();
        let command = object(self.queues[queue].0, c"commandBuffer");
        if command.is_null() { return Err("Metal could not create a command buffer".into()); }
        let blit = object(command, c"blitCommandEncoder");
        if blit.is_null() { return Err("Metal could not create a blit encoder".into()); }
        let fill: unsafe extern "C" fn(Id, Sel, Id, Range, u8) = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        unsafe { fill(blit, selector(c"fillBuffer:range:value:"), self.buffers[queue].0, Range { location: 0, length: 8 * 1024 * 1024 }, 0x35 + queue as u8); }
        tell(blit, c"endEncoding");
        tell(command, c"commit");
        tell(command, c"waitUntilCompleted");
        let status: unsafe extern "C" fn(Id, Sel) -> usize = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        let status = unsafe { status(command, selector(c"status")) };
        if status != 4 { return Err(format!("Metal command ended with status {status}")); }
        let time: unsafe extern "C" fn(Id, Sel) -> f64 = unsafe { std::mem::transmute(objc_msgSend as *const ()) };
        let start = unsafe { time(command, selector(c"GPUStartTime")) };
        let end = unsafe { time(command, selector(c"GPUEndTime")) };
        if end <= start { return Err(format!("Metal completed without a positive GPU timestamp interval: {start}..{end}")); }
        Ok(end - start)
    }
}
